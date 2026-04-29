import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IpcMain } from "electron";
import {
	type GitGetConfigResponse,
	type GitInitResponse,
	type GitDetectMainBranchResponse,
	type GitOperationError,
	type GitOperationErrorCode,
	type GitSaveCredentialsResponse,
	type GitSetIdentityResponse,
	type GitSetRemoteResponse,
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

function isNoSuchRemote(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return s.includes("no such remote") || s.includes("not a git repository");
}

function isRemoteAlreadyExists(stderr: string): boolean {
	return stderr.toLowerCase().includes("remote origin already exists");
}

function isInvalidRemoteUrl(stderr: string): boolean {
	const s = stderr.toLowerCase();
	return (
		s.includes("invalid remote") ||
		s.includes("invalid url") ||
		s.includes("bad/illegal format") ||
		s.includes("does not appear to be a git repository")
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

function toGitError(result: RunGitResult, fallbackMessage: string): GitOperationError {
	const rawOutput = [result.stderr, result.stdout].filter(Boolean).join("\n");

	if (result.errorCode === "ENOENT") {
		return gitError(
			"E_GIT_NOT_FOUND",
			"Git is not installed or not found in PATH.",
			result.stderr || undefined,
			rawOutput || undefined,
		);
	}

	if (result.timedOut) {
		return gitError(
			"E_TIMEOUT",
			"Git operation timed out.",
			result.stderr || undefined,
			rawOutput || undefined,
		);
	}

	if (isNotGitRepo(result.stderr)) {
		return gitError(
			"E_NOT_A_GIT_REPO",
			"This directory is not a Git repository.",
			result.stderr || undefined,
			rawOutput || undefined,
		);
	}

	return gitError(
		"E_UNKNOWN",
		result.stderr || fallbackMessage,
		result.stderr || undefined,
		rawOutput || undefined,
	);
}

async function getConfig(projectDir: string): Promise<GitGetConfigResponse> {
	if (!existsSync(join(projectDir, ".git"))) {
		return { ok: true, hasGit: false, remoteUrl: null };
	}

	const remoteRes = await runGit(projectDir, ["remote", "get-url", "origin"]);
	if (remoteRes.exitCode === 0) {
		return {
			ok: true,
			hasGit: true,
			remoteUrl: remoteRes.stdout || null,
		};
	}

	if (remoteRes.errorCode === "ENOENT") {
		return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
	}

	if (isNoSuchRemote(remoteRes.stderr)) {
		if (remoteRes.stderr.toLowerCase().includes("not a git repository")) {
			return gitError(
				"E_NOT_A_GIT_REPO",
				"This directory is not a Git repository.",
				remoteRes.stderr || undefined,
			);
		}
		return { ok: true, hasGit: true, remoteUrl: null };
	}

	return toGitError(remoteRes, "Unexpected error loading Git config.");
}

async function initRepo(projectDir: string): Promise<GitInitResponse> {
	const res = await runGit(projectDir, ["init"]);
	if (res.exitCode === 0) {
		return { ok: true, output: [res.stdout, res.stderr].filter(Boolean).join("\n") };
	}

	if (res.errorCode === "ENOENT") {
		return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
	}

	return gitError(
		"E_INIT_FAILED",
		"Failed to initialize repository. Check directory permissions.",
		res.stderr || undefined,
		[res.stderr, res.stdout].filter(Boolean).join("\n") || undefined,
	);
}

async function setRemote(projectDir: string, url: string): Promise<GitSetRemoteResponse> {
	const addRes = await runGit(projectDir, ["remote", "add", "origin", url]);
	if (addRes.exitCode === 0) {
		return { ok: true, remoteUrl: url };
	}

	if (addRes.errorCode === "ENOENT") {
		return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
	}

	if (isRemoteAlreadyExists(addRes.stderr)) {
		const setUrlRes = await runGit(projectDir, ["remote", "set-url", "origin", url]);
		if (setUrlRes.exitCode === 0) {
			return { ok: true, remoteUrl: url };
		}
		if (setUrlRes.errorCode === "ENOENT") {
			return gitError(
				"E_GIT_NOT_FOUND",
				"Git is not installed or not found in PATH.",
			);
		}
		if (isInvalidRemoteUrl(setUrlRes.stderr)) {
			return gitError(
				"E_INVALID_REMOTE_URL",
				"The URL provided was rejected by Git. Check the format.",
				setUrlRes.stderr || undefined,
				[setUrlRes.stderr, setUrlRes.stdout].filter(Boolean).join("\n") || undefined,
			);
		}
		return toGitError(setUrlRes, "Failed to update remote URL.");
	}

	if (isInvalidRemoteUrl(addRes.stderr)) {
		return gitError(
			"E_INVALID_REMOTE_URL",
			"The URL provided was rejected by Git. Check the format.",
			addRes.stderr || undefined,
			[addRes.stderr, addRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	return toGitError(addRes, "Failed to configure remote URL.");
}

async function saveCredentials(
	projectDir: string,
	url: string,
	username: string,
	password: string,
): Promise<GitSaveCredentialsResponse> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return gitError(
			"E_CREDENTIALS_SAVE_FAILED",
			"Failed to save credentials. You may need to enter them again on next push.",
		);
	}

	const protocol = parsed.protocol.replace(":", "");
	const host = parsed.host;
	const payload = `protocol=${protocol}\nhost=${host}\nusername=${username}\npassword=${password}\n\n`;

	return await new Promise<GitSaveCredentialsResponse>((resolve) => {
		const child = spawn("git", ["credential", "approve"], {
			cwd: projectDir,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stderr = "";
		let stdout = "";

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		child.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ENOENT") {
				resolve(gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH."));
				return;
			}
			resolve(
				gitError(
					"E_CREDENTIALS_SAVE_FAILED",
					"Failed to save credentials. You may need to enter them again on next push.",
					stderr.trim() || err.message,
					[stderr, stdout].filter(Boolean).join("\n") || undefined,
				),
			);
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ ok: true });
				return;
			}
			resolve(
				gitError(
					"E_CREDENTIALS_SAVE_FAILED",
					"Failed to save credentials. You may need to enter them again on next push.",
					stderr.trim() || undefined,
					[stderr, stdout].filter(Boolean).join("\n") || undefined,
				),
			);
		});

		child.stdin.write(payload);
		child.stdin.end();
	});
}

async function setIdentity(
	projectDir: string,
	userName: string,
	userEmail: string,
): Promise<GitSetIdentityResponse> {
	const nameRes = await runGit(projectDir, ["config", "--local", "user.name", userName]);
	if (nameRes.exitCode !== 0) {
		if (nameRes.errorCode === "ENOENT") {
			return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
		}
		if (isNotGitRepo(nameRes.stderr)) {
			return gitError("E_NOT_A_GIT_REPO", "This directory is not a Git repository.");
		}
		return gitError(
			"E_IDENTITY_SET_FAILED",
			"Failed to configure Git identity. Check that the repository is valid.",
			nameRes.stderr || undefined,
			[nameRes.stderr, nameRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	const emailRes = await runGit(projectDir, [
		"config",
		"--local",
		"user.email",
		userEmail,
	]);
	if (emailRes.exitCode !== 0) {
		if (emailRes.errorCode === "ENOENT") {
			return gitError("E_GIT_NOT_FOUND", "Git is not installed or not found in PATH.");
		}
		if (isNotGitRepo(emailRes.stderr)) {
			return gitError("E_NOT_A_GIT_REPO", "This directory is not a Git repository.");
		}
		return gitError(
			"E_IDENTITY_SET_FAILED",
			"Failed to configure Git identity. Check that the repository is valid.",
			emailRes.stderr || undefined,
			[emailRes.stderr, emailRes.stdout].filter(Boolean).join("\n") || undefined,
		);
	}

	return { ok: true };
}

async function detectMainBranch(projectDir: string): Promise<string | null> {
	const symRef = await runGit(
		projectDir,
		["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
		5_000,
	);
	if (symRef.exitCode === 0 && symRef.stdout) {
		const parts = symRef.stdout.trim().split("/");
		const branch = parts.slice(1).join("/");
		if (branch) return branch;
	}

	const remoteShow = await runGit(projectDir, ["remote", "show", "origin"], 15_000);
	if (remoteShow.exitCode === 0 && remoteShow.stdout) {
		const match = remoteShow.stdout.match(/HEAD branch:\s*(\S+)/);
		if (match?.[1] && match[1] !== "(unknown)") return match[1];
	}

	for (const candidate of ["main", "master", "trunk", "develop"]) {
		const verifyRes = await runGit(
			projectDir,
			["rev-parse", "--verify", `origin/${candidate}`],
			5_000,
		);
		if (verifyRes.exitCode === 0) return candidate;
	}

	return null;
}

export function registerGitConfigHandlers(ipcMain: IpcMain): void {
	ipcMain.handle(
		IPC_CHANNELS.GIT_GET_CONFIG,
		async (_event, req: { projectDir: string }) => {
			return getConfig(req.projectDir);
		},
	);

	ipcMain.handle(IPC_CHANNELS.GIT_INIT, async (_event, req: { projectDir: string }) => {
		return initRepo(req.projectDir);
	});

	ipcMain.handle(
		IPC_CHANNELS.GIT_SET_REMOTE,
		async (_event, req: { projectDir: string; url: string }) => {
			return setRemote(req.projectDir, req.url);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_SAVE_CREDENTIALS,
		async (
			_event,
			req: {
				projectDir: string;
				url: string;
				username: string;
				password: string;
			},
		) => {
			return saveCredentials(req.projectDir, req.url, req.username, req.password);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_SET_IDENTITY,
		async (
			_event,
			req: { projectDir: string; userName: string; userEmail: string },
		) => {
			return setIdentity(req.projectDir, req.userName, req.userEmail);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH,
		async (_event, req: { projectDir: string }): Promise<GitDetectMainBranchResponse> => {
			try {
				const branch = await detectMainBranch(req.projectDir);
				return { ok: true, branch };
			} catch {
				return { ok: true, branch: null };
			}
		},
	);
}
