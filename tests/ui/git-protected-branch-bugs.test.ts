import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GIT_BRANCHES_PANEL_PATH = join(
	__dirname,
	"../../src/ui/components/GitIntegrationModal/GitBranchesPanel.tsx",
);

const GIT_CHANGES_PANEL_PATH = join(
	__dirname,
	"../../src/ui/components/GitIntegrationModal/GitChangesPanel.tsx",
);

describe("Git Branches — protected branch visible as source base", () => {
	it("keeps all local branches for BranchCreator source selector", async () => {
		const source = await readFile(GIT_BRANCHES_PANEL_PATH, "utf-8");

		expect(source).toContain("const localBranches = useMemo(() => {");
		expect(source).toContain("allLocalBranches={localBranches}");
		expect(source).toContain("orderedLocalBranches.map((branch) => (");
	});

	it("shows visual protected label in From: selector options", async () => {
		const source = await readFile(GIT_BRANCHES_PANEL_PATH, "utf-8");

		expect(source).toContain("branch.name === props.protectedBranch");
		expect(source).toContain("\" 🔒 protected\"");
	});

	it("shows clear error when no local branches exist", async () => {
		const source = await readFile(GIT_BRANCHES_PANEL_PATH, "utf-8");

		expect(source).toContain("No branches found in this repository");
		expect(source).toContain("!hasRealBranches && (");
	});

	it("prefers protected branch in From selector after connection", async () => {
		const source = await readFile(GIT_BRANCHES_PANEL_PATH, "utf-8");

		expect(source).toContain("sourceBranch !== props.protectedBranch");
		expect(source).toContain("setSourceBranch(props.protectedBranch)");
	});
});

describe("Git Changes — protected branch commit is visually blocked", () => {
	it("disables Add and Commit action when branch is protected", async () => {
		const source = await readFile(GIT_CHANGES_PANEL_PATH, "utf-8");

		expect(source).toContain("!props.isProtectedBranch");
		expect(source).toContain("disabled={!canCommit}");
	});

	it("renders explicit protected branch error banner", async () => {
		const source = await readFile(GIT_CHANGES_PANEL_PATH, "utf-8");

		expect(source).toContain("props.isProtectedBranch && (");
		expect(source).toContain("git-changes__protected-branch-error");
		expect(source).toContain(
			"You cannot commit or push directly to the main branch.",
		);
	});
});
