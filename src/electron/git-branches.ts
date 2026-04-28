import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IpcMain } from "electron";
import {
	type GitBranch,
	type GitCheckoutBranchResponse,
	type GitCommit,
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
	rawOutput?: string,
): GitOperationError {
	return { ok: false, code, message, rawOutput };
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

function isRepoWithoutCommits(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("not a valid object name") ||
		s.includes("ambiguous argument 'head'")
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
			rawOutput,
		);
	}
	if (result.timedOut) {
		return gitError("E_TIMEOUT", "Git operation timed out.", rawOutput);
	}
	if (isNotGitRepo(result.stderr)) {
		return gitError(
			"E_NOT_A_GIT_REPO",
			"The selected folder is not a Git repository.",
			rawOutput,
		);
	}
	if (isMergeConflict(result.stderr)) {
		return gitError(
			"E_MERGE_CONFLICT",
			"Pull failed due to merge conflicts.",
			rawOutput,
		);
	}
	if (isDirtyWorkingDir(result.stderr)) {
		return gitError(
			"E_DIRTY_WORKING_DIR",
			"Your working directory has uncommitted changes blocking this operation.",
			rawOutput,
		);
	}
	if (isBranchNotFound(result.stderr)) {
		return gitError(
			"E_BRANCH_NOT_FOUND",
			"The requested branch does not exist.",
			rawOutput,
		);
	}
	if (isNoRemote(result.stderr)) {
		return gitError(
			"E_NO_REMOTE",
			"No remote configured or remote unreachable.",
			rawOutput,
		);
	}

	return gitError("E_UNKNOWN", fallbackMessage, rawOutput || undefined);
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

	const localRes = await runGit(projectDir, [
		"branch",
		"--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)",
	]);
	if (localRes.exitCode !== 0) {
		if (isRepoWithoutCommits(localRes.stderr)) {
			return { ok: true, currentBranch: "", branches: [] };
		}
		return toGitError(localRes, "Failed to list Git branches.");
	}

	const branches: GitBranch[] = [];
	let currentBranch = "";

	for (const rawLine of localRes.stdout.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const [nameRaw, headRaw, upstreamRaw, trackRaw] = line.split("|");
		const name = (nameRaw ?? "").trim();
		if (!name) continue;
		const isCurrent = (headRaw ?? "").trim() === "*";
		const upstream = (upstreamRaw ?? "").trim();
		const track = (trackRaw ?? "").trim();
		const { ahead, behind } = parseUpstreamTrack(track);

		if (isCurrent) currentBranch = name;

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
		IPC_CHANNELS.GIT_GET_BRANCH_COMMITS,
		async (
			_event,
			req: { projectDir: string; branch: string; limit?: number },
		) => {
			return getBranchCommits(req.projectDir, req.branch, req.limit ?? 20);
		},
	);
}
