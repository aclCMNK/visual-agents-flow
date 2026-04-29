import { describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "../../src/electron/bridge.types.ts";
import { registerGitBranchesHandlers } from "../../src/electron/git-branches.ts";

type Handler = (_event: unknown, req: any) => Promise<any>;

function makeIpcMainMock() {
	const handlers = new Map<string, Handler>();
	return {
		handle(channel: string, handler: Handler) {
			handlers.set(channel, handler);
		},
		getHandler(channel: string): Handler {
			const handler = handlers.get(channel);
			if (!handler) {
				throw new Error(`Missing IPC handler for channel: ${channel}`);
			}
			return handler;
		},
	};
}

function runGit(projectDir: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd: projectDir }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr || String(error)));
				return;
			}
			resolve((stdout ?? "").trim());
		});
	});
}

async function makeRemoteAndClone(): Promise<{ rootDir: string; remoteDir: string; cloneDir: string }> {
	const rootDir = await mkdtemp(join(tmpdir(), "af-git-divergence-"));
	const sourceDir = join(rootDir, "source");
	const remoteDir = join(rootDir, "origin.git");
	const cloneDir = join(rootDir, "clone");

	await mkdir(sourceDir, { recursive: true });
	await runGit(sourceDir, ["init"]);
	await runGit(sourceDir, ["config", "user.name", "Test User"]);
	await runGit(sourceDir, ["config", "user.email", "test@example.com"]);
	await runGit(sourceDir, ["checkout", "-b", "main"]);
	await writeFile(join(sourceDir, "README.md"), "base\n", "utf-8");
	await runGit(sourceDir, ["add", "README.md"]);
	await runGit(sourceDir, ["commit", "-m", "initial commit"]);

	await runGit(rootDir, ["clone", "--bare", sourceDir, remoteDir]);
	await runGit(rootDir, ["clone", remoteDir, cloneDir]);
	await runGit(cloneDir, ["checkout", "main"]);
	await runGit(cloneDir, ["config", "user.name", "Test User"]);
	await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

	return { rootDir, remoteDir, cloneDir };
}

describe("Git divergence handling", () => {
	it("returns no divergence on clean synced repo", async () => {
		const { rootDir, cloneDir } = await makeRemoteAndClone();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);

			const result = await handleDivergence({}, { projectDir: cloneDir, remoteBranch: "main" });

			expect(result.ok).toBe(true);
			expect(result.divergenceDetected).toBe(false);
			expect(result.savedBranch).toBeNull();
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("saves dirty tree to local-changes branch and syncs main", async () => {
		const { rootDir, cloneDir } = await makeRemoteAndClone();
		try {
			await writeFile(join(cloneDir, "README.md"), "base\ndirty\n", "utf-8");

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);

			const result = await handleDivergence({}, { projectDir: cloneDir, remoteBranch: "main" });

			expect(result.ok).toBe(true);
			expect(result.divergenceDetected).toBe(true);
			expect(result.savedBranch).toMatch(/^local-changes-/);
			expect(result.message).toContain(result.savedBranch as string);

			const currentBranch = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(currentBranch).toBe("main");

			await runGit(cloneDir, ["rev-parse", "--verify", `refs/heads/${result.savedBranch as string}`]);
			await runGit(cloneDir, ["checkout", result.savedBranch as string]);
			const latestMsg = await runGit(cloneDir, ["log", "-1", "--pretty=%s"]);
			expect(latestMsg).toContain("[agentsflow-auto]");
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("saves local-ahead history into safety branch", async () => {
		const { rootDir, cloneDir } = await makeRemoteAndClone();
		try {
			await writeFile(join(cloneDir, "ahead.txt"), "ahead\n", "utf-8");
			await runGit(cloneDir, ["add", "ahead.txt"]);
			await runGit(cloneDir, ["commit", "-m", "local ahead commit"]);

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);

			const result = await handleDivergence({}, { projectDir: cloneDir, remoteBranch: "main" });

			expect(result.ok).toBe(true);
			expect(result.divergenceDetected).toBe(true);
			expect(result.savedBranch).toMatch(/^local-changes-/);

			const currentBranch = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(currentBranch).toBe("main");

			await runGit(cloneDir, ["checkout", result.savedBranch as string]);
			const latestMsg = await runGit(cloneDir, ["log", "-1", "--pretty=%s"]);
			expect(latestMsg).toBe("local ahead commit");
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("handles empty repo with dirty tree", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "af-git-divergence-empty-"));
		const sourceDir = join(rootDir, "source");
		const remoteDir = join(rootDir, "origin.git");
		const localDir = join(rootDir, "local");

		try {
			await mkdir(sourceDir, { recursive: true });
			await runGit(sourceDir, ["init"]);
			await runGit(sourceDir, ["config", "user.name", "Test User"]);
			await runGit(sourceDir, ["config", "user.email", "test@example.com"]);
			await runGit(sourceDir, ["checkout", "-b", "main"]);
			await writeFile(join(sourceDir, "README.md"), "remote\n", "utf-8");
			await runGit(sourceDir, ["add", "README.md"]);
			await runGit(sourceDir, ["commit", "-m", "remote initial"]);

			await runGit(rootDir, ["clone", "--bare", sourceDir, remoteDir]);

			await mkdir(localDir, { recursive: true });
			await runGit(localDir, ["init"]);
			await runGit(localDir, ["config", "user.name", "Test User"]);
			await runGit(localDir, ["config", "user.email", "test@example.com"]);
			await runGit(localDir, ["remote", "add", "origin", remoteDir]);
			await writeFile(join(localDir, "notes.md"), "local only\n", "utf-8");

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);

			const result = await handleDivergence({}, { projectDir: localDir, remoteBranch: "main" });

			expect(result.ok).toBe(true);
			expect(result.divergenceDetected).toBe(true);
			expect(result.savedBranch).toMatch(/^local-changes-/);

			const currentBranch = await runGit(localDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(currentBranch).toBe("main");
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("skips divergence when HEAD is detached", async () => {
		const { rootDir, cloneDir } = await makeRemoteAndClone();
		try {
			await runGit(cloneDir, ["checkout", "--detach"]);

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);

			const result = await handleDivergence({}, { projectDir: cloneDir, remoteBranch: "main" });

			expect(result.ok).toBe(true);
			expect(result.divergenceDetected).toBe(false);
			expect(result.savedBranch).toBeNull();
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});
