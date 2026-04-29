import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IpcMain } from "electron";
import {
	type GitBranch,
	type GitCheckoutBranchResponse,
	type GitCommit,
	type GitHandleDivergenceResponse,
	type GitCreateBranchRequest,
	type GitCreateBranchResponse,
	type GitEnsureLocalBranchResponse,
	type GitFetchAndPullResponse,
	type GitGetBranchCommitsResponse,
	type GitGetRemoteDiffResponse,
	type GitListBranchesResponse,
	type GitOperationError,
	type GitOperationErrorCode,
	type GitPullBranchResponse,
	IPC_CHANNELS,
} from "./bridge.types.ts";

type RunGitResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	errorCode?: string | number;
	timedOut: boolean;
};

function gitError(
	code: GitOperationErrorCode,
	message: string,
	gitStderr?: string,
	rawOutput?: string,
): GitOperationError {
	return { ok: false, code, message, gitStderr, rawOutput };
}

function isNotGitRepo(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return s.includes("not a git repository");
}

function isNoRemote(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("no such remote") ||
		s.includes("no tracking information") ||
		s.includes("has no upstream branch") ||
		s.includes("couldn't find remote ref") ||
		s.includes("could not read from remote repository") ||
		s.includes("could not resolve host") ||
		s.includes("network is unreachable") ||
		s.includes("failed to connect") ||
		s.includes("unable to access")
	);
}

function isMergeConflict(stderr: string): boolean {
	return stderr.toUpperCase().includes("CONFLICT");
}

function isDirtyWorkingDir(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("your local changes") ||
		s.includes("would be overwritten by checkout") ||
		s.includes("please commit your changes")
	);
}

function isBranchNotFound(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("did not match any file(s) known to git") ||
		s.includes("unknown revision or path not in the working tree") ||
		s.includes("unknown revision")
	);
}

function toGitError(
	result: RunGitResult,
	fallbackMessage: string,
): GitOperationError {
	const rawOutput = [result.stderr, result.stdout].filter(Boolean).join("\n");

	if (result.errorCode === "ENOENT") {
		return gitError(
			"E_GIT_NOT_FOUND",
			"Git is not installed or not found in PATH.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (result.timedOut) {
		return gitError(
			"E_TIMEOUT",
			"Git operation timed out.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (isNotGitRepo(result.stderr)) {
		return gitError(
			"E_NOT_A_GIT_REPO",
			"The selected folder is not a Git repository.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (isMergeConflict(result.stderr)) {
		return gitError(
			"E_MERGE_CONFLICT",
			"Pull failed due to merge conflicts.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (isDirtyWorkingDir(result.stderr)) {
		return gitError(
			"E_DIRTY_WORKING_DIR",
			"Your working directory has uncommitted changes blocking this operation.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (isBranchNotFound(result.stderr)) {
		return gitError(
			"E_BRANCH_NOT_FOUND",
			"The requested branch does not exist.",
			result.stderr || undefined,
			rawOutput,
		);
	}
	if (isNoRemote(result.stderr)) {
		return gitError(
			"E_NO_REMOTE",
			"No remote configured or remote unreachable.",
			result.stderr || undefined,
			rawOutput,
		);
	}

	return gitError(
		"E_UNKNOWN",
		result.stderr || fallbackMessage,
		result.stderr || undefined,
		rawOutput || undefined,
	);
}

/**
 * Ejecuta un comando git en el directorio dado.
 * Nunca lanza — siempre resuelve con stdout/stderr/exitCode.
 */
async function runGit(
	projectDir: string,
	args: string[],
	timeoutMs = 10_000,
): Promise<RunGitResult> {
	return new Promise((resolve) => {
		execFile(
			"git",
			args,
			{ cwd: projectDir, timeout: timeoutMs, windowsHide: true },
			(error, stdout, stderr) => {
				const err = error as
					| (NodeJS.ErrnoException & { code?: number | string })
					| null;
				const exitCodeRaw = err?.code ?? 0;
				resolve({
					stdout: (stdout ?? "").trim(),
					stderr: (stderr ?? "").trim(),
					exitCode:
						typeof exitCodeRaw === "number" ? exitCodeRaw : error ? 1 : 0,
					errorCode: err?.code,
					timedOut: Boolean(err?.killed && err?.signal === "SIGTERM"),
				});
			},
		);
	});
}

function ensureGitRepo(projectDir: string): GitOperationError | null {
	if (!existsSync(join(projectDir, ".git"))) {
		return gitError(
			"E_NOT_A_GIT_REPO",
			"The selected folder is not a Git repository.",
		);
	}
	return null;
}

function parseUpstreamTrack(track: string): { ahead: number; behind: number } {
	const ahead = Number((track.match(/ahead\s+(\d+)/)?.[1] ?? "0").trim()) || 0;
	const behind =
		Number((track.match(/behind\s+(\d+)/)?.[1] ?? "0").trim()) || 0;
	return { ahead, behind };
}

function parseCommitsFromLog(stdout: string): GitCommit[] {
	if (!stdout) return [];
	const lines = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const commits: GitCommit[] = [];

	for (const line of lines) {
		const [fullHash, hash, message, author, date, relativeDate] =
			line.split("\u0000");
		if (!fullHash || !hash || !message || !author || !date || !relativeDate)
			continue;
		commits.push({ fullHash, hash, message, author, date, relativeDate });
	}

	return commits;
}

type DivergenceSnapshot = {
	hasDirtyTree: boolean;
	aheadCount: number;
	behindCount: number;
	headIsAncestor: boolean;
	emptyRepo: boolean;
	hasRemoteRef: boolean;
};

function formatDivergenceBranchName(now: Date): {
	datePart: string;
	timePart: string;
	branchName: string;
} {
	const pad = (n: number) => String(n).padStart(2, "0");
	const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return {
		datePart,
		timePart,
		branchName: `local-changes-${datePart}-${timePart}`,
	};
}

function randomSuffix(length = 4): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let out = "";
	for (let i = 0; i < length; i += 1) {
		const idx = Math.floor(Math.random() * chars.length);
		out += chars[idx] ?? "a";
	}
	return out;
}

function buildDivergenceMessage(
	branchName: string,
	stashPopHadConflicts: boolean,
): string {
	const base = `Your local changes have been saved in the branch '${branchName}'. You can merge them into the main branch when ready.`;
	if (!stashPopHadConflicts) return base;
	return `${base} Note: Some changes could not be automatically restored. Run 'git stash list' to find them.`;
}

async function detectDivergence(
	projectDir: string,
	remoteBranch: string,
): Promise<DivergenceSnapshot> {
	const statusRes = await runGit(projectDir, ["status", "--porcelain"]);
	const hasDirtyTree = statusRes.exitCode === 0 && statusRes.stdout.trim().length > 0;

	const headRes = await runGit(projectDir, ["rev-parse", "HEAD"]);
	const emptyRepo = headRes.exitCode !== 0;

	const remoteRefRes = await runGit(projectDir, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/remotes/origin/${remoteBranch}`,
	]);
	const hasRemoteRef = remoteRefRes.exitCode === 0;

	if (emptyRepo) {
		return {
			hasDirtyTree,
			aheadCount: 0,
			behindCount: 0,
			headIsAncestor: true,
			emptyRepo: true,
			hasRemoteRef,
		};
	}

	if (!hasRemoteRef) {
		return {
			hasDirtyTree,
			aheadCount: 0,
			behindCount: 0,
			headIsAncestor: true,
			emptyRepo: false,
			hasRemoteRef: false,
		};
	}

	const aheadRes = await runGit(projectDir, [
		"rev-list",
		"--count",
		`origin/${remoteBranch}..HEAD`,
	]);
	const behindRes = await runGit(projectDir, [
		"rev-list",
		"--count",
		`HEAD..origin/${remoteBranch}`,
	]);
	const aheadCount =
		aheadRes.exitCode === 0
			? Number.parseInt(aheadRes.stdout || "0", 10) || 0
			: 0;
	const behindCount =
		behindRes.exitCode === 0
			? Number.parseInt(behindRes.stdout || "0", 10) || 0
			: 0;

	const ancestorRes = await runGit(projectDir, [
		"merge-base",
		"--is-ancestor",
		"HEAD",
		`origin/${remoteBranch}`,
	]);
	const headIsAncestor = ancestorRes.exitCode === 0;

	return {
		hasDirtyTree,
		aheadCount,
		behindCount,
		headIsAncestor,
		emptyRepo: false,
		hasRemoteRef: true,
	};
}

async function handleDivergence(
	projectDir: string,
	remoteBranch: string,
): Promise<GitHandleDivergenceResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const currentBranch = await getCurrentBranch(projectDir);
	if (!currentBranch) {
		const headVerifyRes = await runGit(projectDir, ["rev-parse", "--verify", "HEAD"]);
		const isEmptyRepo = headVerifyRes.exitCode !== 0;
		if (isEmptyRepo) {
			// Empty repo (no commits yet): continue flow and rely on status-based divergence.
		} else {
			console.warn("[git:handle-divergence] Detached HEAD detected. Skipping divergence flow.");
			return {
				ok: true,
				divergenceDetected: false,
				savedBranch: null,
				message: null,
			};
		}
	}

	const fetchRes = await runGit(projectDir, ["fetch", "origin"], 20_000);
	if (fetchRes.exitCode !== 0) {
		return toGitError(fetchRes, "Failed to fetch remote.");
	}

	const divergence = await detectDivergence(projectDir, remoteBranch);
	const isDiverged =
		divergence.hasDirtyTree ||
		divergence.aheadCount > 0 ||
		!divergence.headIsAncestor;

	if (!isDiverged) {
		return {
			ok: true,
			divergenceDetected: false,
			savedBranch: null,
			message: null,
		};
	}

	const now = new Date();
	const { datePart, timePart, branchName: baseBranchName } =
		formatDivergenceBranchName(now);
	let tempBranch = baseBranchName;

	let stashCreated = false;
	const shouldUseStash = divergence.hasDirtyTree && !divergence.emptyRepo;
	if (shouldUseStash) {
		const stashRes = await runGit(projectDir, [
			"stash",
			"push",
			"--include-untracked",
			"-m",
			`agentsflow-divergence-${datePart}-${timePart}`,
		]);
		if (stashRes.exitCode !== 0) {
			return gitError(
				"E_DIVERGENCE_SAVE_FAILED",
				"Could not save local changes automatically. Please commit or stash your changes manually before connecting to the remote.",
				stashRes.stderr || undefined,
				[stashRes.stderr, stashRes.stdout].filter(Boolean).join("\n") || undefined,
			);
		}
		stashCreated = true;
	}

	let createRes = await runGit(projectDir, ["checkout", "-b", tempBranch]);
	if (createRes.exitCode !== 0) {
		const alreadyExists = /already exists/i.test(createRes.stderr);
		if (alreadyExists) {
			tempBranch = `${baseBranchName}-${randomSuffix(4)}`;
			createRes = await runGit(projectDir, ["checkout", "-b", tempBranch]);
		}
	}

	if (createRes.exitCode !== 0) {
		if (stashCreated) {
			await runGit(projectDir, ["stash", "pop"]);
		}
		return gitError(
			"E_DIVERGENCE_SAVE_FAILED",
			"Could not save local changes automatically. Please commit or stash your changes manually before connecting to the remote.",
			createRes.stderr || undefined,
			[createRes.stderr, createRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	let stashPopHadConflicts = false;
	if (stashCreated) {
		const popRes = await runGit(projectDir, ["stash", "pop"]);
		if (popRes.exitCode !== 0) {
			stashPopHadConflicts = true;
		}
	}

	const statusAfterPop = await runGit(projectDir, ["status", "--porcelain"]);
	const hasChangesToCommit =
		statusAfterPop.exitCode === 0 && statusAfterPop.stdout.trim().length > 0;

	if (hasChangesToCommit) {
		const addRes = await runGit(projectDir, ["add", "-A"]);
		if (addRes.exitCode !== 0) {
			return gitError(
				"E_DIVERGENCE_SAVE_FAILED",
				`Local changes saved to '${tempBranch}', but could not stage files.`,
				addRes.stderr || undefined,
				[addRes.stderr, addRes.stdout].filter(Boolean).join("\n") || undefined,
			);
		}

		const commitRes = await runGit(projectDir, [
			"commit",
			"-m",
			"chore: save local changes before remote sync [agentsflow-auto]",
		]);
		if (commitRes.exitCode !== 0) {
			return gitError(
				"E_DIVERGENCE_SAVE_FAILED",
				`Local changes saved to '${tempBranch}', but commit failed.`,
				commitRes.stderr || undefined,
				[commitRes.stderr, commitRes.stdout].filter(Boolean).join("\n") || undefined,
			);
		}
	}

	if (!divergence.hasRemoteRef) {
		return {
			ok: true,
			divergenceDetected: true,
			savedBranch: tempBranch,
			message: buildDivergenceMessage(tempBranch, stashPopHadConflicts),
		};
	}

	const localExistsRes = await runGit(projectDir, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${remoteBranch}`,
	]);

	let checkoutRes: RunGitResult;
	if (localExistsRes.exitCode === 0) {
		checkoutRes = await runGit(projectDir, ["checkout", remoteBranch]);
	} else {
		checkoutRes = await runGit(projectDir, [
			"checkout",
			"-b",
			remoteBranch,
			`origin/${remoteBranch}`,
		]);
	}

	if (checkoutRes.exitCode !== 0) {
		return gitError(
			"E_DIVERGENCE_SAVE_FAILED",
			`Local changes saved to '${tempBranch}', but could not checkout '${remoteBranch}'.`,
			checkoutRes.stderr || undefined,
			[checkoutRes.stderr, checkoutRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	const pullRes = await runGit(projectDir, ["pull", "--ff-only"], 30_000);
	if (pullRes.exitCode !== 0) {
		return gitError(
			"E_DIVERGENCE_SAVE_FAILED",
			`Local changes saved to '${tempBranch}', but pull failed on '${remoteBranch}'.`,
			pullRes.stderr || undefined,
			[pullRes.stderr, pullRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	return {
		ok: true,
		divergenceDetected: true,
		savedBranch: tempBranch,
		message: buildDivergenceMessage(tempBranch, stashPopHadConflicts),
	};
}

async function getCurrentBranch(projectDir: string): Promise<string> {
	const res = await runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (res.exitCode !== 0) return "";
	if (res.stdout === "HEAD") return "";
	return res.stdout;
}

async function listBranches(
	projectDir: string,
): Promise<GitListBranchesResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const currentBranch = await getCurrentBranch(projectDir);
	const localRes = await runGit(projectDir, [
		"for-each-ref",
		"--format=%(refname:short)|%(upstream:short)|%(upstream:track)",
		"refs/heads",
	]);
	if (localRes.exitCode !== 0) {
		return toGitError(localRes, "Failed to list Git branches.");
	}

	const branches: GitBranch[] = [];

	for (const rawLine of localRes.stdout.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const [nameRaw, upstreamRaw, trackRaw] = line.split("|");
		const name = (nameRaw ?? "").trim();
		if (!name) continue;
		const isCurrent = name === currentBranch;
		const upstream = (upstreamRaw ?? "").trim();
		const track = (trackRaw ?? "").trim();
		const { ahead, behind } = parseUpstreamTrack(track);

		branches.push({
			name,
			isCurrent,
			isRemote: false,
			hasUpstream: Boolean(upstream),
			aheadCount: ahead,
			behindCount: behind,
		});
	}

	const remoteRes = await runGit(projectDir, [
		"branch",
		"-r",
		"--format=%(refname:short)",
	]);
	if (remoteRes.exitCode === 0 && remoteRes.stdout) {
		for (const rawLine of remoteRes.stdout.split("\n")) {
			const line = rawLine.trim();
			if (!line || line.endsWith("/HEAD")) continue;
			const [remote, ...rest] = line.split("/");
			if (!remote || rest.length === 0) continue;
			branches.push({
				name: rest.join("/"),
				isCurrent: false,
				isRemote: true,
				remote,
				hasUpstream: true,
				aheadCount: 0,
				behindCount: 0,
			});
		}
	}

	return { ok: true, currentBranch, branches };
}

async function getRemoteDiff(
	projectDir: string,
	branch?: string,
): Promise<GitGetRemoteDiffResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const branchName = (branch ?? (await getCurrentBranch(projectDir))).trim();
	if (!branchName) {
		return {
			ok: true,
			incomingCommits: [],
			aheadCount: 0,
			behindCount: 0,
			noUpstream: true,
		};
	}

	const upstreamRes = await runGit(projectDir, [
		"rev-parse",
		"--abbrev-ref",
		`${branchName}@{upstream}`,
	]);
	if (upstreamRes.exitCode !== 0 || !upstreamRes.stdout) {
		if (upstreamRes.errorCode === "ENOENT") {
			return gitError(
				"E_GIT_NOT_FOUND",
				"Git is not installed or not found in PATH.",
			);
		}
		return {
			ok: true,
			incomingCommits: [],
			aheadCount: 0,
			behindCount: 0,
			noUpstream: true,
		};
	}

	const upstreamRef = upstreamRes.stdout.trim();
	const fetchRes = await runGit(projectDir, ["fetch", "origin"], 15_000);
	if (fetchRes.exitCode !== 0) {
		if (fetchRes.timedOut) {
			return gitError(
				"E_TIMEOUT",
				"Fetch timed out while contacting remote.",
				fetchRes.stderr || undefined,
				fetchRes.stderr,
			);
		}
		return toGitError(fetchRes, "Failed to fetch remote changes.");
	}

	const logRes = await runGit(projectDir, [
		"log",
		`${branchName}..${upstreamRef}`,
		"--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%ar",
	]);
	if (logRes.exitCode !== 0) {
		return toGitError(logRes, "Failed to read remote incoming commits.");
	}

	const behindRes = await runGit(projectDir, [
		"rev-list",
		"--count",
		`${branchName}..${upstreamRef}`,
	]);
	const aheadRes = await runGit(projectDir, [
		"rev-list",
		"--count",
		`${upstreamRef}..${branchName}`,
	]);

	const behindCount =
		behindRes.exitCode === 0
			? Number.parseInt(behindRes.stdout || "0", 10) || 0
			: 0;
	const aheadCount =
		aheadRes.exitCode === 0
			? Number.parseInt(aheadRes.stdout || "0", 10) || 0
			: 0;

	return {
		ok: true,
		incomingCommits: parseCommitsFromLog(logRes.stdout),
		aheadCount,
		behindCount,
		noUpstream: false,
	};
}

async function fetchAndPull(
	projectDir: string,
): Promise<GitFetchAndPullResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const pullRes = await runGit(projectDir, ["pull", "--ff-only"], 30_000);
	if (pullRes.exitCode !== 0) {
		return toGitError(pullRes, "Failed to fetch and pull from remote.");
	}

	const output = [pullRes.stdout, pullRes.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	const alreadyUpToDate = /already up[ -]to[ -]date/i.test(output);

	return {
		ok: true,
		output,
		alreadyUpToDate,
	};
}

async function pullBranch(
	projectDir: string,
	branch: string,
): Promise<GitPullBranchResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const branchName = branch.trim();
	if (!branchName) {
		return gitError("E_BRANCH_NOT_FOUND", "Branch name is required.");
	}

	const pullRes = await runGit(
		projectDir,
		["pull", "origin", branchName],
		30_000,
	);
	if (pullRes.exitCode !== 0) {
		return toGitError(pullRes, `Failed to pull branch '${branchName}'.`);
	}

	const output = [pullRes.stdout, pullRes.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	const alreadyUpToDate = /already up[ -]to[ -]date/i.test(output);

	return { ok: true, output, alreadyUpToDate };
}

async function checkoutBranch(
	projectDir: string,
	branch: string,
): Promise<GitCheckoutBranchResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const branchName = branch.trim();
	if (!branchName) {
		return gitError("E_BRANCH_NOT_FOUND", "Branch name is required.");
	}

	const checkoutRes = await runGit(projectDir, ["checkout", branchName]);
	if (checkoutRes.exitCode === 0) {
		return {
			ok: true,
			branch: branchName,
			output: [checkoutRes.stdout, checkoutRes.stderr]
				.filter(Boolean)
				.join("\n")
				.trim(),
		};
	}

	if (isBranchNotFound(checkoutRes.stderr)) {
		const fallbackRes = await runGit(projectDir, [
			"checkout",
			"-b",
			branchName,
			`origin/${branchName}`,
		]);
		if (fallbackRes.exitCode === 0) {
			return {
				ok: true,
				branch: branchName,
				output: [fallbackRes.stdout, fallbackRes.stderr]
					.filter(Boolean)
					.join("\n")
					.trim(),
			};
		}
		return toGitError(
			fallbackRes,
			`Failed to checkout branch '${branchName}'.`,
		);
	}

	return toGitError(checkoutRes, `Failed to checkout branch '${branchName}'.`);
}

async function ensureLocalBranch(
	projectDir: string,
	branch: string,
): Promise<GitEnsureLocalBranchResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const branchName = branch.trim();
	if (!branchName) {
		return gitError("E_BRANCH_NOT_FOUND", "Branch name is required.");
	}

	const fetchRes = await runGit(projectDir, ["fetch", "origin"], 20_000);
	if (fetchRes.exitCode !== 0) {
		return toGitError(
			fetchRes,
			`Failed to fetch remote branch '${branchName}'.`,
		);
	}

	const localExistsRes = await runGit(projectDir, [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/heads/${branchName}`,
	]);
	const localExists = localExistsRes.exitCode === 0;

	if (!localExists && localExistsRes.errorCode === "ENOENT") {
		return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
	}

	if (!localExists) {
		const remoteExistsRes = await runGit(projectDir, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/remotes/origin/${branchName}`,
		]);
		if (remoteExistsRes.exitCode !== 0) {
			if (remoteExistsRes.errorCode === "ENOENT") {
				return gitError(
					"E_GIT_NOT_FOUND",
					"Git is not installed or not found in PATH.",
				);
			}
			return gitError(
				"E_BRANCH_NOT_FOUND",
				`Remote branch 'origin/${branchName}' does not exist.`,
				remoteExistsRes.stderr || undefined,
				[remoteExistsRes.stderr, remoteExistsRes.stdout]
					.filter(Boolean)
					.join("\n") || undefined,
			);
		}

		const createCheckoutRes = await runGit(projectDir, [
			"checkout",
			"-b",
			branchName,
			`origin/${branchName}`,
		]);
		if (createCheckoutRes.exitCode !== 0) {
			return toGitError(
				createCheckoutRes,
				`Failed to create local branch '${branchName}' from origin/${branchName}.`,
			);
		}

		const pullCreatedRes = await runGit(projectDir, ["pull", "--ff-only"], 30_000);
		if (pullCreatedRes.exitCode !== 0) {
			return toGitError(
				pullCreatedRes,
				`Failed to pull updates for branch '${branchName}'.`,
			);
		}

		const output = [
			fetchRes.stdout,
			fetchRes.stderr,
			createCheckoutRes.stdout,
			createCheckoutRes.stderr,
			pullCreatedRes.stdout,
			pullCreatedRes.stderr,
		]
			.filter(Boolean)
			.join("\n")
			.trim();

		return { ok: true, branch: branchName, created: true, output };
	}

	const checkoutRes = await runGit(projectDir, ["checkout", branchName]);
	if (checkoutRes.exitCode !== 0) {
		return toGitError(checkoutRes, `Failed to checkout branch '${branchName}'.`);
	}

	const pullRes = await runGit(projectDir, ["pull", "--ff-only"], 30_000);
	if (pullRes.exitCode !== 0) {
		return toGitError(pullRes, `Failed to pull updates for branch '${branchName}'.`);
	}

	const output = [
		fetchRes.stdout,
		fetchRes.stderr,
		checkoutRes.stdout,
		checkoutRes.stderr,
		pullRes.stdout,
		pullRes.stderr,
	]
		.filter(Boolean)
		.join("\n")
		.trim();

	return { ok: true, branch: branchName, created: false, output };
}

async function getBranchCommits(
	projectDir: string,
	branch: string,
	limit = 20,
): Promise<GitGetBranchCommitsResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const branchName = branch.trim();
	if (!branchName) {
		return gitError("E_BRANCH_NOT_FOUND", "Branch name is required.");
	}

	const safeLimit =
		Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
	const logRes = await runGit(projectDir, [
		"log",
		branchName,
		"--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%ar",
		"-n",
		String(safeLimit),
	]);

	if (logRes.exitCode !== 0) {
		return toGitError(
			logRes,
			`Failed to load commits for branch '${branchName}'.`,
		);
	}

	return {
		ok: true,
		branch: branchName,
		commits: parseCommitsFromLog(logRes.stdout),
	};
}

async function createBranch(
	projectDir: string,
	newBranchName: string,
	sourceBranch: string,
	protectedBranch?: string,
): Promise<GitCreateBranchResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	const trimmed = newBranchName.trim();
	if (!trimmed || !/^[a-zA-Z0-9][a-zA-Z0-9\-]*$/.test(trimmed)) {
		return gitError("E_INVALID_BRANCH_NAME", `Invalid branch name: '${trimmed}'.`);
	}

	if (protectedBranch && trimmed === protectedBranch) {
		return gitError(
			"E_INVALID_BRANCH_NAME",
			`Cannot create a branch named '${trimmed}' — it is the protected branch.`,
		);
	}

	if (!protectedBranch && ["main", "master"].includes(trimmed.toLowerCase())) {
		return gitError(
			"E_INVALID_BRANCH_NAME",
			`Cannot create a branch named '${trimmed}'.`,
		);
	}

	const sourceName = sourceBranch.trim();
	const sourceRes = await runGit(projectDir, ["rev-parse", "--verify", sourceName]);
	if (sourceRes.exitCode !== 0) {
		return gitError(
			"E_BRANCH_NOT_FOUND",
			`Source branch '${sourceName}' does not exist.`,
			sourceRes.stderr || undefined,
			sourceRes.stderr || sourceRes.stdout || undefined,
		);
	}

	const existsRes = await runGit(projectDir, ["rev-parse", "--verify", trimmed]);
	if (existsRes.exitCode === 0) {
		return gitError(
			"E_BRANCH_ALREADY_EXISTS",
			`Branch '${trimmed}' already exists.`,
		);
	}

	const createRes = await runGit(projectDir, [
		"checkout",
		"-b",
		trimmed,
		sourceName,
	]);
	if (createRes.exitCode !== 0) {
		return toGitError(createRes, `Failed to create branch '${trimmed}'.`);
	}

	return { ok: true, branch: trimmed, checkedOut: true };
}

export function registerGitBranchesHandlers(ipcMain: IpcMain): void {
	ipcMain.handle(
		IPC_CHANNELS.GIT_LIST_BRANCHES,
		async (_event, req: { projectDir: string }) => {
			return listBranches(req.projectDir);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_GET_REMOTE_DIFF,
		async (_event, req: { projectDir: string; branch?: string }) => {
			return getRemoteDiff(req.projectDir, req.branch);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_FETCH_AND_PULL,
		async (_event, req: { projectDir: string }) => {
			return fetchAndPull(req.projectDir);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_PULL_BRANCH,
		async (_event, req: { projectDir: string; branch: string }) => {
			return pullBranch(req.projectDir, req.branch);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_CHECKOUT_BRANCH,
		async (_event, req: { projectDir: string; branch: string }) => {
			return checkoutBranch(req.projectDir, req.branch);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH,
		async (_event, req: { projectDir: string; branch: string }) => {
			return ensureLocalBranch(req.projectDir, req.branch);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_HANDLE_DIVERGENCE,
		async (_event, req: { projectDir: string; remoteBranch: string }) => {
			return handleDivergence(req.projectDir, req.remoteBranch);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_GET_BRANCH_COMMITS,
		async (
			_event,
			req: { projectDir: string; branch: string; limit?: number },
		) => {
			return getBranchCommits(req.projectDir, req.branch, req.limit ?? 20);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_CREATE_BRANCH,
		async (_event, req: GitCreateBranchRequest) => {
			return createBranch(
				req.projectDir,
				req.newBranchName,
				req.sourceBranch,
				req.protectedBranch,
			);
		},
	);
}
