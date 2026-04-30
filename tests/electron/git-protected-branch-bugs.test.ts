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

async function makeClonedRepoOnDivergenceBranch(): Promise<{
	cloneDir: string;
	divergenceBranch: string;
	cleanupPaths: string[];
}> {
	const root = await mkdtemp(join(tmpdir(), "af-git-divergence-guard-"));
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
	await runGit(cloneDir, ["config", "user.name", "Test User"]);
	await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

	// Simulate a divergence: create a local-changes-* branch and check it out
	const divergenceBranch = "local-changes-20260429-120000";
	await runGit(cloneDir, ["checkout", "-b", divergenceBranch]);
	await writeFile(join(cloneDir, "local.txt"), "local changes\n", "utf-8");
	await runGit(cloneDir, ["add", "local.txt"]);
	await runGit(cloneDir, ["commit", "-m", "chore: save local changes before remote sync [agentsflow-auto]"]);

	return { cloneDir, divergenceBranch, cleanupPaths: [root] };
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

	// FIX: BUG_DIVERGENCE_BRANCH_CHECKOUT — Bug 1
	// ensureLocalBranch must NOT checkout to protected branch when user is on local-changes-*
	it("[FIX-DIV-GUARD-1] ensureLocalBranch does NOT checkout to protected branch when user is on local-changes-*", async () => {
		const { cloneDir, divergenceBranch, cleanupPaths } = await makeClonedRepoOnDivergenceBranch();
		try {
			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			// Precondition: user is on local-changes-* branch
			const headBefore = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headBefore).toBe(divergenceBranch);

			// Call ensureLocalBranch for the protected branch (main already exists locally)
			const result = await ensureLocalBranch({}, {
				projectDir: cloneDir,
				branch: "main",
			});

			// Must succeed
			expect(result.ok).toBe(true);
			expect(result.branch).toBe("main");
			expect(result.created).toBe(false);

			// INVARIANT: user must still be on local-changes-* — no checkout to main
			const headAfter = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfter).toBe(divergenceBranch);
			expect(headAfter).not.toBe("main");
		} finally {
			for (const p of cleanupPaths) {
				await rm(p, { recursive: true, force: true });
			}
		}
	});

	// FIX: BUG_DIVERGENCE_BRANCH_CHECKOUT — Bug 1 (variant: local-changes-* with timestamp suffix)
	// Ensures the startsWith("local-changes-") guard works for any timestamp variant
	it("[FIX-DIV-GUARD-1] ensureLocalBranch preserves any local-changes-YYYYMMDD-HHMMSS variant", async () => {
		const { cloneDir, cleanupPaths } = await makeClonedRepoWithOriginMain();
		try {
			await runGit(cloneDir, ["config", "user.name", "Test User"]);
			await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

			// Simulate divergence branch with a different timestamp
			const divergenceBranch = "local-changes-20260101-093045";
			await runGit(cloneDir, ["checkout", "-b", divergenceBranch]);
			await writeFile(join(cloneDir, "change.txt"), "change\n", "utf-8");
			await runGit(cloneDir, ["add", "change.txt"]);
			await runGit(cloneDir, ["commit", "-m", "chore: save local changes [agentsflow-auto]"]);

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			const result = await ensureLocalBranch({}, {
				projectDir: cloneDir,
				branch: "main",
			});

			expect(result.ok).toBe(true);

			// INVARIANT: still on divergence branch
			const headAfter = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfter).toBe(divergenceBranch);
			expect(headAfter).not.toBe("main");
		} finally {
			for (const p of cleanupPaths) {
				await rm(p, { recursive: true, force: true });
			}
		}
	});

	// FIX: BUG_DIVERGENCE_BRANCH_CHECKOUT — Bug 1 (variant: random suffix)
	// Ensures the guard works for local-changes-*-XXXX (with random suffix from collision avoidance)
	it("[FIX-DIV-GUARD-1] ensureLocalBranch preserves local-changes-* with random suffix", async () => {
		const { cloneDir, cleanupPaths } = await makeClonedRepoWithOriginMain();
		try {
			await runGit(cloneDir, ["config", "user.name", "Test User"]);
			await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

			// Simulate divergence branch with random suffix (collision avoidance)
			const divergenceBranch = "local-changes-20260429-120000-ab3f";
			await runGit(cloneDir, ["checkout", "-b", divergenceBranch]);
			await writeFile(join(cloneDir, "extra.txt"), "extra\n", "utf-8");
			await runGit(cloneDir, ["add", "extra.txt"]);
			await runGit(cloneDir, ["commit", "-m", "chore: save local changes [agentsflow-auto]"]);

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			const result = await ensureLocalBranch({}, {
				projectDir: cloneDir,
				branch: "main",
			});

			expect(result.ok).toBe(true);

			// INVARIANT: still on divergence branch (with suffix)
			const headAfter = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfter).toBe(divergenceBranch);
			expect(headAfter).not.toBe("main");
		} finally {
			for (const p of cleanupPaths) {
				await rm(p, { recursive: true, force: true });
			}
		}
	});

	// FIX: BUG_DIVERGENCE_BRANCH_CHECKOUT — verify normal flow still works (regression guard)
	// When user is NOT on local-changes-*, ensureLocalBranch MUST still checkout to protected branch
	it("[FIX-DIV-GUARD-REGRESSION] ensureLocalBranch still checks out to protected branch when NOT on local-changes-*", async () => {
		const { cloneDir, cleanupPaths } = await makeClonedRepoWithOriginMain();
		try {
			await runGit(cloneDir, ["config", "user.name", "Test User"]);
			await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

			// Create and switch to a regular feature branch (not local-changes-*)
			await runGit(cloneDir, ["checkout", "-b", "feature-xyz"]);

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			const result = await ensureLocalBranch({}, {
				projectDir: cloneDir,
				branch: "main",
			});

			expect(result.ok).toBe(true);
			expect(result.branch).toBe("main");

			// Normal flow: user should be checked out to main
			const headAfter = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfter).toBe("main");
		} finally {
			for (const p of cleanupPaths) {
				await rm(p, { recursive: true, force: true });
			}
		}
	});

	// FIX: BUG_DIVERGENCE_BRANCH_CHECKOUT — end-to-end divergence flow
	// After handleDivergence succeeds, a subsequent ensureLocalBranch call must NOT move the user
	it("[FIX-DIV-GUARD-E2E] after handleDivergence, ensureLocalBranch does not move user off local-changes-*", async () => {
		const { rootDir, cloneDir } = await (async () => {
			const root = await mkdtemp(join(tmpdir(), "af-git-e2e-divergence-"));
			const sourceDir = join(root, "source");
			const bareDir = join(root, "origin.git");
			const cloneDir = join(root, "clone");

			await mkdir(sourceDir, { recursive: true });
			await runGit(sourceDir, ["init"]);
			await runGit(sourceDir, ["config", "user.name", "Test User"]);
			await runGit(sourceDir, ["config", "user.email", "test@example.com"]);
			await runGit(sourceDir, ["checkout", "-b", "main"]);
			await writeFile(join(sourceDir, "README.md"), "base\n", "utf-8");
			await runGit(sourceDir, ["add", "README.md"]);
			await runGit(sourceDir, ["commit", "-m", "initial"]);

			await runGit(root, ["clone", "--bare", sourceDir, bareDir]);
			await runGit(root, ["clone", bareDir, cloneDir]);
			await runGit(cloneDir, ["config", "user.name", "Test User"]);
			await runGit(cloneDir, ["config", "user.email", "test@example.com"]);

			return { rootDir: root, cloneDir };
		})();

		try {
			// Introduce dirty tree to trigger divergence
			await writeFile(join(cloneDir, "work.txt"), "in progress\n", "utf-8");

			const ipcMain = makeIpcMainMock();
			registerGitBranchesHandlers(ipcMain as any);
			const handleDivergence = ipcMain.getHandler(IPC_CHANNELS.GIT_HANDLE_DIVERGENCE);
			const ensureLocalBranch = ipcMain.getHandler(IPC_CHANNELS.GIT_ENSURE_LOCAL_BRANCH);

			// Step 1: handle divergence → user lands on local-changes-*
			const divResult = await handleDivergence({}, { projectDir: cloneDir, remoteBranch: "main" });
			expect(divResult.ok).toBe(true);
			expect(divResult.divergenceDetected).toBe(true);
			const savedBranch = divResult.savedBranch as string;
			expect(savedBranch).toMatch(/^local-changes-/);

			const headAfterDiv = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfterDiv).toBe(savedBranch);

			// Step 2: simulate loadBranches calling ensureLocalBranch (Bug 2 scenario)
			const ensureResult = await ensureLocalBranch({}, { projectDir: cloneDir, branch: "main" });
			expect(ensureResult.ok).toBe(true);

			// INVARIANT: user must still be on local-changes-* after ensureLocalBranch
			const headAfterEnsure = await runGit(cloneDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(headAfterEnsure).toBe(savedBranch);
			expect(headAfterEnsure).not.toBe("main");
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});
