import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IpcMain } from "electron";
import {
	type GitAddAndCommitResponse,
	type GitChangedFile,
	type GitFileStatusCode,
	type GitGetStatusResponse,
	type GitOperationError,
	type GitOperationErrorCode,
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
	return stderr.toLowerCase().includes("not a git repository");
}

function isRepoWithoutCommits(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("not a valid object name") ||
		s.includes("ambiguous argument 'head'")
	);
}

function isNothingToCommit(stderrOrStdout: string): boolean {
	const s = stderrOrStdout.toLowerCase();
	return (
		s.includes("nothing to commit") ||
		s.includes("no changes added to commit") ||
		s.includes("nothing added to commit")
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

	return gitError(
		"E_UNKNOWN",
		result.stderr || fallbackMessage,
		result.stderr || undefined,
		rawOutput || undefined,
	);
}

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

function normalizeStatusCode(code: string): GitFileStatusCode {
	const validCodes: GitFileStatusCode[] = ["M", "A", "D", "R", "C", "U", "?", " "];
	if (validCodes.includes(code as GitFileStatusCode)) {
		return code as GitFileStatusCode;
	}
	return " ";
}

function parseStatusLine(line: string): GitChangedFile | null {
	if (line.length < 3) return null;

	const x = normalizeStatusCode(line[0] ?? " ");
	const y = normalizeStatusCode(line[1] ?? " ");
	if (x === " " && y === " ") return null;
	if (line[0] === "!" && line[1] === "!") return null;

	let pathPart = line.slice(3);
	let originalPath: string | undefined;

	if (pathPart.includes(" -> ")) {
		const [orig, current] = pathPart.split(" -> ");
		if (orig && current) {
			originalPath = orig;
			pathPart = current;
		}
	}

	if (!pathPart) return null;

	const isUntracked = x === "?" && y === "?";
	const isStaged = x !== " " && x !== "?";
	const isUnstaged = y !== " " && y !== "?";

	return {
		path: pathPart,
		stagedStatus: x,
		unstagedStatus: y,
		isStaged,
		isUnstaged,
		isUntracked,
		originalPath,
	};
}

async function getStatus(projectDir: string): Promise<GitGetStatusResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	let currentBranch = "";
	const branchRes = await runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branchRes.exitCode === 0) {
		currentBranch = branchRes.stdout === "HEAD" ? "" : branchRes.stdout;
	} else if (branchRes.errorCode === "ENOENT") {
		return toGitError(branchRes, "Failed to resolve current branch.");
	}

	const statusRes = await runGit(projectDir, ["status", "--porcelain=v1", "-u"]);
	if (statusRes.exitCode !== 0) {
		if (isRepoWithoutCommits(statusRes.stderr)) {
			return {
				ok: true,
				currentBranch: "",
				files: [],
				stagedCount: 0,
				unstagedCount: 0,
			};
		}
		return toGitError(statusRes, "Failed to read Git status.");
	}

	const files: GitChangedFile[] = [];
	for (const rawLine of statusRes.stdout.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line) continue;
		const parsed = parseStatusLine(line);
		if (!parsed) continue;
		files.push(parsed);
	}

	const stagedCount = files.filter((f) => f.isStaged).length;
	const unstagedCount = files.filter((f) => f.isUnstaged || f.isUntracked).length;

	return {
		ok: true,
		currentBranch,
		files,
		stagedCount,
		unstagedCount,
	};
}

async function addAndCommit(
	projectDir: string,
	message: string,
	description?: string,
): Promise<GitAddAndCommitResponse> {
	const repoError = ensureGitRepo(projectDir);
	if (repoError) return repoError;

	if (message.trim().length === 0) {
		return gitError("E_EMPTY_COMMIT_MSG", "Commit message cannot be empty.");
	}

	const addRes = await runGit(projectDir, ["add", "-A"], 30_000);
	if (addRes.exitCode !== 0) {
		return toGitError(addRes, "Failed to stage changes before commit.");
	}

	const commitArgs = ["commit", "-m", message];
	if (description && description.trim().length > 0) {
		commitArgs.push("-m", description);
	}

	const commitRes = await runGit(projectDir, commitArgs, 30_000);
	if (commitRes.exitCode !== 0) {
		const combinedOutput = [commitRes.stderr, commitRes.stdout]
			.filter(Boolean)
			.join("\n");
		if (isNothingToCommit(combinedOutput)) {
			return gitError(
				"E_NOTHING_TO_COMMIT",
				"Nothing to commit. Working tree is clean.",
				commitRes.stderr || undefined,
				combinedOutput,
			);
		}
		return toGitError(commitRes, "Failed to create commit.");
	}

	const output = [commitRes.stdout, commitRes.stderr].filter(Boolean).join("\n").trim();
	let commitHash = output.match(/\[.+? ([a-f0-9]+)\]/i)?.[1] ?? "";

	if (!commitHash) {
		const hashRes = await runGit(projectDir, ["rev-parse", "--short", "HEAD"]);
		if (hashRes.exitCode === 0) {
			commitHash = hashRes.stdout;
		}
	}

	return {
		ok: true,
		commitHash,
		output,
	};
}

export function registerGitChangesHandlers(ipcMain: IpcMain): void {
	ipcMain.handle(
		IPC_CHANNELS.GIT_GET_STATUS,
		async (_event, req: { projectDir: string }) => {
			return getStatus(req.projectDir);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_ADD_AND_COMMIT,
		async (
			_event,
			req: { projectDir: string; message: string; description?: string },
		) => {
			return addAndCommit(req.projectDir, req.message, req.description);
		},
	);
}
