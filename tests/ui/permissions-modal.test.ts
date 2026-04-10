/**
 * tests/ui/permissions-modal.test.ts
 *
 * Unit tests for the pure helpers exported from PermissionsModal:
 *   - PERMISSION_VALUES constant
 *   - validateLocalState() — validation logic for the new object-based shape
 *
 * Also tests the permissionsModalTarget state and
 * openPermissionsModal / closePermissionsModal actions on agentFlowStore.
 *
 * These tests are pure logic tests — no DOM, no React rendering.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { PERMISSION_VALUES, validateLocalState } from "../../src/ui/components/Permissions/index.ts";
import { useAgentFlowStore } from "../../src/ui/store/agentFlowStore.ts";

// ── PERMISSION_VALUES ──────────────────────────────────────────────────────

describe("PERMISSION_VALUES", () => {
  it("contains exactly allow, deny, ask", () => {
    expect(PERMISSION_VALUES).toContain("allow");
    expect(PERMISSION_VALUES).toContain("deny");
    expect(PERMISSION_VALUES).toContain("ask");
    expect(PERMISSION_VALUES.length).toBe(3);
  });
});

// ── validateLocalState — valid cases ──────────────────────────────────────

describe("validateLocalState — valid inputs", () => {
  it("returns hasErrors=false for empty state", () => {
    const { hasErrors } = validateLocalState({ ungrouped: [], groups: [] });
    expect(hasErrors).toBe(false);
  });

  it("returns hasErrors=false for a single valid ungrouped permission", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [{ localId: "u1", name: "read", value: "allow" }],
      groups: [],
    });
    expect(hasErrors).toBe(false);
    expect(state.ungrouped[0]?.error).toBeUndefined();
  });

  it("returns hasErrors=false for multiple valid ungrouped permissions", () => {
    const { hasErrors } = validateLocalState({
      ungrouped: [
        { localId: "u1", name: "read",    value: "allow" },
        { localId: "u2", name: "execute", value: "ask"   },
        { localId: "u3", name: "write",   value: "deny"  },
      ],
      groups: [],
    });
    expect(hasErrors).toBe(false);
  });

  it("returns hasErrors=false for a valid group with permissions", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [
            { localId: "p1", name: "run-scripts", value: "allow" },
            { localId: "p2", name: "write-files", value: "deny"  },
          ],
        },
      ],
    });
    expect(hasErrors).toBe(false);
    expect(state.groups[0]?.nameError).toBeUndefined();
    expect(state.groups[0]?.perms[0]?.error).toBeUndefined();
    expect(state.groups[0]?.perms[1]?.error).toBeUndefined();
  });

  it("returns hasErrors=false for ungrouped and grouped permissions together", () => {
    const { hasErrors } = validateLocalState({
      ungrouped: [{ localId: "u1", name: "global-read", value: "allow" }],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [{ localId: "p1", name: "execute", value: "allow" }],
        },
      ],
    });
    expect(hasErrors).toBe(false);
  });

  it("triangulate: empty group (no permissions) is valid", () => {
    const { hasErrors } = validateLocalState({
      ungrouped: [],
      groups: [{ localId: "g1", name: "WebSearch", perms: [] }],
    });
    expect(hasErrors).toBe(false);
  });
});

// ── validateLocalState — empty names ──────────────────────────────────────

describe("validateLocalState — empty ungrouped permission name", () => {
  it("sets error and hasErrors=true for blank ungrouped name", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [{ localId: "u1", name: "   ", value: "allow" }],
      groups: [],
    });
    expect(hasErrors).toBe(true);
    expect(state.ungrouped[0]?.error).toBeTruthy();
  });

  it("sets error for empty string ungrouped name", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [{ localId: "u1", name: "", value: "allow" }],
      groups: [],
    });
    expect(hasErrors).toBe(true);
    expect(state.ungrouped[0]?.error).toMatch(/required/i);
  });
});

describe("validateLocalState — empty group name", () => {
  it("sets nameError and hasErrors=true for blank group name", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [{ localId: "g1", name: "", perms: [] }],
    });
    expect(hasErrors).toBe(true);
    expect(state.groups[0]?.nameError).toMatch(/required/i);
  });
});

describe("validateLocalState — empty permission name inside group", () => {
  it("sets error and hasErrors=true for blank perm name inside group", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [{ localId: "p1", name: "", value: "allow" }],
        },
      ],
    });
    expect(hasErrors).toBe(true);
    expect(state.groups[0]?.perms[0]?.error).toMatch(/required/i);
  });
});

// ── validateLocalState — duplicate names ──────────────────────────────────

describe("validateLocalState — duplicate ungrouped names", () => {
  it("reports error on second duplicate ungrouped name (case-insensitive)", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [
        { localId: "u1", name: "read",  value: "allow" },
        { localId: "u2", name: "Read",  value: "deny"  },
      ],
      groups: [],
    });
    expect(hasErrors).toBe(true);
    expect(state.ungrouped[0]?.error).toBeUndefined();
    expect(state.ungrouped[1]?.error).toBeTruthy();
  });

  it("triangulate: three ungrouped where second and third share same name", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [
        { localId: "u1", name: "alpha", value: "allow" },
        { localId: "u2", name: "beta",  value: "allow" },
        { localId: "u3", name: "beta",  value: "deny"  },
      ],
      groups: [],
    });
    expect(hasErrors).toBe(true);
    expect(state.ungrouped[0]?.error).toBeUndefined();
    expect(state.ungrouped[1]?.error).toBeUndefined();
    expect(state.ungrouped[2]?.error).toBeTruthy();
  });
});

describe("validateLocalState — duplicate group names", () => {
  it("reports error on second group with duplicate name", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [
        { localId: "g1", name: "Bash", perms: [] },
        { localId: "g2", name: "bash", perms: [] },
      ],
    });
    expect(hasErrors).toBe(true);
    expect(state.groups[0]?.nameError).toBeUndefined();
    expect(state.groups[1]?.nameError).toBeTruthy();
  });
});

describe("validateLocalState — ungrouped name conflicts with group name", () => {
  it("reports duplicate error when ungrouped name equals a group name", () => {
    // ungrouped "Bash" comes first → group "Bash" gets duplicate error
    const { hasErrors, state } = validateLocalState({
      ungrouped: [{ localId: "u1", name: "Bash", value: "allow" }],
      groups: [{ localId: "g1", name: "Bash", perms: [] }],
    });
    expect(hasErrors).toBe(true);
    // ungrouped is processed first, group is the duplicate
    expect(state.ungrouped[0]?.error).toBeUndefined();
    expect(state.groups[0]?.nameError).toBeTruthy();
  });
});

describe("validateLocalState — duplicate perm names within a group", () => {
  it("flags second duplicate perm within same group", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [
            { localId: "p1", name: "execute", value: "allow" },
            { localId: "p2", name: "execute", value: "deny"  },
          ],
        },
      ],
    });
    expect(hasErrors).toBe(true);
    expect(state.groups[0]?.perms[0]?.error).toBeUndefined();
    expect(state.groups[0]?.perms[1]?.error).toBeTruthy();
  });

  it("triangulate: perm duplicate detection is case-insensitive within group", () => {
    const { hasErrors, state } = validateLocalState({
      ungrouped: [],
      groups: [
        {
          localId: "g1",
          name: "Edit",
          perms: [
            { localId: "p1", name: "Write",  value: "allow" },
            { localId: "p2", name: "write",  value: "deny"  },
          ],
        },
      ],
    });
    expect(hasErrors).toBe(true);
    expect(state.groups[0]?.perms[1]?.error).toBeTruthy();
  });

  it("allows same perm name in DIFFERENT groups (not a duplicate)", () => {
    const { hasErrors } = validateLocalState({
      ungrouped: [],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [{ localId: "p1", name: "execute", value: "allow" }],
        },
        {
          localId: "g2",
          name: "Edit",
          perms: [{ localId: "p2", name: "execute", value: "deny" }],
        },
      ],
    });
    expect(hasErrors).toBe(false);
  });
});

// ── validateLocalState — preserves data ───────────────────────────────────

describe("validateLocalState — preserves data", () => {
  it("does not mutate original state reference", () => {
    const original = {
      ungrouped: [{ localId: "u1", name: "read", value: "allow" as const }],
      groups: [],
    };
    const { state } = validateLocalState(original);
    expect(state).not.toBe(original);
    expect(state.ungrouped).not.toBe(original.ungrouped);
  });

  it("preserves permission values after validation", () => {
    const { state } = validateLocalState({
      ungrouped: [
        { localId: "u1", name: "read",    value: "ask"  },
        { localId: "u2", name: "execute", value: "deny" },
      ],
      groups: [
        {
          localId: "g1",
          name: "Bash",
          perms: [{ localId: "p1", name: "run", value: "allow" }],
        },
      ],
    });
    expect(state.ungrouped[0]?.value).toBe("ask");
    expect(state.ungrouped[1]?.value).toBe("deny");
    expect(state.groups[0]?.perms[0]?.value).toBe("allow");
  });
});

// ── agentFlowStore — permissionsModalTarget ───────────────────────────────

function resetStore() {
  useAgentFlowStore.getState().resetFlow();
}

describe("agentFlowStore — permissionsModalTarget initial state", () => {
  beforeEach(resetStore);

  it("starts as null", () => {
    expect(useAgentFlowStore.getState().permissionsModalTarget).toBeNull();
  });
});

describe("agentFlowStore — openPermissionsModal", () => {
  beforeEach(resetStore);

  it("sets permissionsModalTarget with the provided payload", () => {
    const target = {
      agentId: "agent-abc",
      agentName: "My Agent",
      projectDir: "/projects/test",
    };

    useAgentFlowStore.getState().openPermissionsModal(target);

    const stored = useAgentFlowStore.getState().permissionsModalTarget;
    expect(stored).not.toBeNull();
    expect(stored?.agentId).toBe("agent-abc");
    expect(stored?.agentName).toBe("My Agent");
    expect(stored?.projectDir).toBe("/projects/test");
  });

  it("overwrites a previous target when called again", () => {
    useAgentFlowStore.getState().openPermissionsModal({
      agentId: "agent-1",
      agentName: "Agent One",
      projectDir: "/projects/p1",
    });

    useAgentFlowStore.getState().openPermissionsModal({
      agentId: "agent-2",
      agentName: "Agent Two",
      projectDir: "/projects/p2",
    });

    const stored = useAgentFlowStore.getState().permissionsModalTarget;
    expect(stored?.agentId).toBe("agent-2");
    expect(stored?.agentName).toBe("Agent Two");
  });
});

describe("agentFlowStore — closePermissionsModal", () => {
  beforeEach(resetStore);

  it("resets permissionsModalTarget to null", () => {
    useAgentFlowStore.getState().openPermissionsModal({
      agentId: "agent-xyz",
      agentName: "XYZ",
      projectDir: "/projects/xyz",
    });

    expect(useAgentFlowStore.getState().permissionsModalTarget).not.toBeNull();

    useAgentFlowStore.getState().closePermissionsModal();

    expect(useAgentFlowStore.getState().permissionsModalTarget).toBeNull();
  });

  it("is idempotent — calling close when already null does not throw", () => {
    expect(() => {
      useAgentFlowStore.getState().closePermissionsModal();
      useAgentFlowStore.getState().closePermissionsModal();
    }).not.toThrow();

    expect(useAgentFlowStore.getState().permissionsModalTarget).toBeNull();
  });
});

describe("agentFlowStore — resetFlow clears permissionsModalTarget", () => {
  it("sets permissionsModalTarget back to null", () => {
    useAgentFlowStore.getState().openPermissionsModal({
      agentId: "a",
      agentName: "A",
      projectDir: "/p",
    });

    useAgentFlowStore.getState().resetFlow();

    expect(useAgentFlowStore.getState().permissionsModalTarget).toBeNull();
  });
});
