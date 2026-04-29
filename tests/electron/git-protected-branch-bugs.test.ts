import { describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "../../src/electron/bridge.types.ts";
import { registerGitBranchesHandlers } from "../../src/electron/git-branches.ts";
import { registerGitChangesHandlers } from "../../src/electron/git-changes.ts";

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

async function makeRepoWithMainBranch(): Promise<string> {
	const repoDir = await mkdtemp(join(tmpdir(), "af-git-protected-branch-"));
	await runGit(repoDir, ["init"]);
	await runGit(repoDir, ["config", "user.name", "Test User"]);
	await runGit(repoDir, ["config", "user.email", "test@example.com"]);
	await runGit(repoDir, ["checkout", "-b", "main"]);

	const filePath = join(repoDir, "README.md");
	await writeFile(filePath, "initial\n", "utf-8");
	await runGit(repoDir, ["add", "README.md"]);
	await runGit(repoDir, ["commit", "-m", "initial commit"]);

	return repoDir;
}

async function makeClonedRepoWithOriginMain(): Promise<{ cloneDir: string; cleanupPaths: string[] }> {
	const root = await mkdtemp(join(tmpdir(), "af-git-protected-origin-"));
	const sourceDir = join(root, "source");
	const bareDir = join(root, "origin.git");
	const cloneDir = join(root, "clone");

	await mkdir(sourceDir, { recursive: true });
	await runGit(sourceDir, ["init"]);
	await runGit(sourceDir, ["config", "user.name", "Test User"]);
	await runGit(sourceDir, ["config", "user.email", "test@example.com"]);
	await runGit(sourceDir, ["checkout", "-b", "main"]);
	await writeFile(join(sourceDir, "README.md"), "main\n", "utf-8");
	await runGit(sourceDir, ["add", "README.md"]);
	await runGit(sourceDir, ["commit", "-m", "seed main"]);

	await runGit(root, ["clone", "--bare", sourceDir, bareDir]);
	await runGit(root, ["clone", bareDir, cloneDir]);

	return { cloneDir, cleanupPaths: [root] };
}

describe("Protected branch bugs — backend enforcement", () => {
	it("always returns all local branches including protected while detached", async () => {
		const repoDir = await makeRepoWithMainBranch();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const listBranches = ipcMain.getHandler(IPC_CHANNELS.GIT_LIST_BRANCHES);

			await runGit(repoDir, ["checkout", "--detach"]);

			const result = await listBranches({}, { projectDir: repoDir });

			expect(result.ok).toBe(true);
			expect(result.currentBranch).toBe("");
			const localBranchNames = result.branches
				.filter((branch: { isRemote: boolean }) => !branch.isRemote)
				.map((branch: { name: string }) => branch.name);
			expect(localBranchNames).toContain("main");
		} finally {
			await rm(repoDir, { recursive: true, force: true });
		}
	});

	it("allows creating a branch FROM protected branch main", async () => {
		const repoDir = await makeRepoWithMainBranch();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const createBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_CREATE_BRANCH);

			const result = await createBranch({}, {
				projectDir: repoDir,
				newBranchName: "feature-safe-base",
				sourceBranch: "main",
				protectedBranch: "main",
			});

			expect(result.ok).toBe(true);
			expect(result.branch).toBe("feature-safe-base");

			const headBranch = await runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headBranch).toBe("feature-safe-base");
		} finally {
			await rm(repoDir, { recursive: true, force: true });
		}
	});

	it("blocks commit on protected branch and never creates a commit", async () => {
		const repoDir = await makeRepoWithMainBranch();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitChangesHandlers(ipcMain as any);
			const addAndCommit = ipcMain.getHandler(IPC_CHANNELS.GIT_ADD_AND_COMMIT);

			const filePath = join(repoDir, "README.md");
			await writeFile(filePath, "initial\nchange\n", "utf-8");
			const beforeHead = await runGit(repoDir, ["rev-parse", "HEAD"]);

			const result = await addAndCommit({}, {
				projectDir: repoDir,
				message: "should be blocked",
				protectedBranch: "main",
			});

			expect(result.ok).toBe(false);
			expect(result.code).toBe("E_PROTECTED_BRANCH");

			const afterHead = await runGit(repoDir, ["rev-parse", "HEAD"]);
			expect(afterHead).toBe(beforeHead);

			const status = await runGit(repoDir, ["status", "--porcelain=v1"]);
			expect(status).toContain("M README.md");
		} finally {
			await rm(repoDir, { recursive: true, force: true });
		}
	});

	it("ensures protected branch exists locally from origin when missing", async () => {
		const { cloneDir, cleanupPaths } = await makeClonedRepoWithOriginMain();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			await runGit(cloneDir, ["checkout", "--detach"]);
			await runGit(cloneDir, ["branch", "-D", "main"]);

			const result = await ensureLocalBranch({}, {
				projectDir: cloneDir,
				branch: "main",
			});

			expect(result.ok).toBe(true);
			expect(result.branch).toBe("main");
			expect(result.created).toBe(true);

			const headBranch = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headBranch).toBe("main");
		} finally {
			for (const p of cleanupPaths) {
				await rm(p, { recursive: true, force: true });
			}
		}
	});
});
