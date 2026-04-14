/**
 * tests/ui/user-node.test.ts
 *
 * Unit tests for the "User" special node feature.
 *
 * Covers:
 *   - addUserNode: creates exactly one UserNode at the given position
 *   - addUserNode: no-op if a UserNode already exists (only one allowed)
 *   - removeUserNode: removes the node and any connected links
 *   - moveUserNode: updates position
 *   - resetFlow: clears the UserNode
 *   - loadFromProject: does NOT restore a UserNode (it is non-persistent)
 *   - Connections to/from the user-node ID via addLink (same as regular links)
 *   - Preventing double-add: store enforces singleton
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { useAgentFlowStore, USER_NODE_ID } from "../../src/ui/store/agentFlowStore.ts";

// Re-export USER_NODE_ID for type-safety assertion below.
// If the import succeeds, the constant is exported correctly.

// ── Helpers ────────────────────────────────────────────────────────────────

function resetStore() {
  useAgentFlowStore.getState().resetFlow();
}

// ── addUserNode ────────────────────────────────────────────────────────────

describe("agentFlowStore — addUserNode", () => {
  beforeEach(resetStore);

  it("adds a UserNode at the given coordinates", () => {
    useAgentFlowStore.getState().addUserNode(120, 80);

    const { userNode } = useAgentFlowStore.getState();
    expect(userNode).not.toBeNull();
    expect(userNode?.id).toBe("user-node");
    expect(userNode?.name).toBe("User");
    expect(userNode?.x).toBe(120);
    expect(userNode?.y).toBe(80);
  });

  it("marks the store dirty after adding the user node", () => {
    useAgentFlowStore.getState().addUserNode(0, 0);
    expect(useAgentFlowStore.getState().isDirty).toBe(true);
  });

  it("is a no-op when a UserNode already exists (singleton enforcement)", () => {
    useAgentFlowStore.getState().addUserNode(10, 20);
    const first = useAgentFlowStore.getState().userNode;

    // Second call must NOT overwrite the first
    useAgentFlowStore.getState().addUserNode(999, 999);
    const second = useAgentFlowStore.getState().userNode;

    expect(second?.x).toBe(first?.x);
    expect(second?.y).toBe(first?.y);
  });

  it("starts as null in the initial state", () => {
    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });
});

// ── removeUserNode ─────────────────────────────────────────────────────────

describe("agentFlowStore — removeUserNode", () => {
  beforeEach(resetStore);

  it("removes the UserNode when it exists", () => {
    useAgentFlowStore.getState().addUserNode(50, 50);
    useAgentFlowStore.getState().removeUserNode();

    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });

  it("marks the store dirty after removal", () => {
    useAgentFlowStore.getState().addUserNode(50, 50);
    useAgentFlowStore.getState().markClean();
    useAgentFlowStore.getState().removeUserNode();

    expect(useAgentFlowStore.getState().isDirty).toBe(true);
  });

  it("is a no-op when no UserNode exists", () => {
    // Should not throw
    expect(() => {
      useAgentFlowStore.getState().removeUserNode();
    }).not.toThrow();

    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });

  it("removes links connected to user-node when UserNode is removed", () => {
    // Add a regular agent and the user node
    useAgentFlowStore.getState().commitPlacement(200, 200);
    const agentId = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().addUserNode(100, 100);

    // Connect user-node → agent
    useAgentFlowStore.getState().addLink("user-node", agentId);
    // Connect agent → user-node
    useAgentFlowStore.getState().addLink(agentId, "user-node");

    expect(useAgentFlowStore.getState().links).toHaveLength(2);

    // Remove user node — both links must disappear
    useAgentFlowStore.getState().removeUserNode();

    expect(useAgentFlowStore.getState().links).toHaveLength(0);
  });
});

// ── moveUserNode ───────────────────────────────────────────────────────────

describe("agentFlowStore — moveUserNode", () => {
  beforeEach(resetStore);

  it("updates the position of the UserNode", () => {
    useAgentFlowStore.getState().addUserNode(10, 20);
    useAgentFlowStore.getState().moveUserNode(300, 400);

    const { userNode } = useAgentFlowStore.getState();
    expect(userNode?.x).toBe(300);
    expect(userNode?.y).toBe(400);
  });

  it("marks the store dirty after moving", () => {
    useAgentFlowStore.getState().addUserNode(0, 0);
    useAgentFlowStore.getState().markClean();
    useAgentFlowStore.getState().moveUserNode(50, 50);

    expect(useAgentFlowStore.getState().isDirty).toBe(true);
  });

  it("is a no-op when no UserNode exists", () => {
    expect(() => {
      useAgentFlowStore.getState().moveUserNode(100, 100);
    }).not.toThrow();

    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });

  it("preserves id and name after move", () => {
    useAgentFlowStore.getState().addUserNode(0, 0);
    useAgentFlowStore.getState().moveUserNode(77, 88);

    const { userNode } = useAgentFlowStore.getState();
    expect(userNode?.id).toBe("user-node");
    expect(userNode?.name).toBe("User");
  });
});

// ── Connections (addLink) with user-node ───────────────────────────────────

describe("agentFlowStore — connections involving user-node", () => {
  beforeEach(resetStore);

  it("allows creating a link from user-node to a regular agent", () => {
    useAgentFlowStore.getState().commitPlacement(200, 200);
    const agentId = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().addUserNode(50, 50);

    useAgentFlowStore.getState().addLink("user-node", agentId);

    const links = useAgentFlowStore.getState().links;
    expect(links).toHaveLength(1);
    expect(links[0].fromAgentId).toBe("user-node");
    expect(links[0].toAgentId).toBe(agentId);
  });

  it("allows creating a link from a regular agent to user-node", () => {
    useAgentFlowStore.getState().commitPlacement(200, 200);
    const agentId = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().addUserNode(50, 50);

    useAgentFlowStore.getState().addLink(agentId, "user-node");

    const links = useAgentFlowStore.getState().links;
    expect(links).toHaveLength(1);
    expect(links[0].fromAgentId).toBe(agentId);
    expect(links[0].toAgentId).toBe("user-node");
  });

  it("prevents duplicate links involving user-node", () => {
    useAgentFlowStore.getState().commitPlacement(200, 200);
    const agentId = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().addUserNode(50, 50);

    useAgentFlowStore.getState().addLink("user-node", agentId);
    useAgentFlowStore.getState().addLink("user-node", agentId); // duplicate

    expect(useAgentFlowStore.getState().links).toHaveLength(1);
  });

  it("prevents self-connection on user-node (user-node → user-node)", () => {
    useAgentFlowStore.getState().addUserNode(50, 50);
    useAgentFlowStore.getState().addLink("user-node", "user-node");

    expect(useAgentFlowStore.getState().links).toHaveLength(0);
  });
});

// ── resetFlow clears UserNode ──────────────────────────────────────────────

describe("agentFlowStore — resetFlow clears UserNode", () => {
  beforeEach(resetStore);

  it("removes the UserNode when resetFlow is called", () => {
    useAgentFlowStore.getState().addUserNode(100, 100);
    expect(useAgentFlowStore.getState().userNode).not.toBeNull();

    useAgentFlowStore.getState().resetFlow();
    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });
});

// ── loadFromProject restores UserNode from project.user.position ──────────

describe("agentFlowStore — loadFromProject restores UserNode from position", () => {
  beforeEach(resetStore);

  it("restores a UserNode at the saved position when project.user.position is present", () => {
    const mockProject = {
      id: "test-proj",
      name: "Test",
      description: "",
      user: { user_id: "user-node", position: { x: 120, y: 300 } },
      agents: [],
      connections: [],
      properties: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    useAgentFlowStore.getState().loadFromProject(mockProject);

    const { userNode } = useAgentFlowStore.getState();
    expect(userNode).not.toBeNull();
    expect(userNode?.id).toBe("user-node");
    expect(userNode?.name).toBe("User");
    expect(userNode?.x).toBe(120);
    expect(userNode?.y).toBe(300);
  });

  it("does NOT restore a UserNode when project.user is absent", () => {
    // Add a UserNode before the load to ensure it gets cleared
    useAgentFlowStore.getState().addUserNode(50, 50);
    expect(useAgentFlowStore.getState().userNode).not.toBeNull();

    const mockProject = {
      id: "test-proj",
      name: "Test",
      description: "",
      // no `user` field
      agents: [],
      connections: [],
      properties: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    useAgentFlowStore.getState().loadFromProject(mockProject);

    // UserNode must be null — no user node in this project
    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });

  it("does NOT restore a UserNode when project.user exists but has no position", () => {
    const mockProject = {
      id: "test-proj",
      name: "Test",
      description: "",
      user: { user_id: "user-node" }, // no position
      agents: [],
      connections: [],
      properties: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    useAgentFlowStore.getState().loadFromProject(mockProject);

    // Position-less user object → don't show the node on canvas
    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });

  it("marks the store as clean (isDirty = false) after load with a restored user node", () => {
    const mockProject = {
      id: "test-proj",
      name: "Test",
      description: "",
      user: { user_id: "user-node", position: { x: 50, y: 50 } },
      agents: [],
      connections: [],
      properties: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    useAgentFlowStore.getState().loadFromProject(mockProject);

    expect(useAgentFlowStore.getState().isDirty).toBe(false);
  });
});

// ── loadFromProject does NOT restore UserNode (old test — kept for backward compat) ──────────

describe("agentFlowStore — loadFromProject does not restore UserNode", () => {
  it("keeps userNode null after loading a project with no user field", () => {
    // Add a UserNode before the load
    useAgentFlowStore.getState().addUserNode(50, 50);
    expect(useAgentFlowStore.getState().userNode).not.toBeNull();

    // Simulate a project load (minimal mock) — no `user` field
    const mockProject = {
      id: "test-proj",
      name: "Test",
      description: "",
      agents: [],
      connections: [],
      properties: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    useAgentFlowStore.getState().loadFromProject(mockProject);

    // UserNode must have been cleared — no user node in this project
    expect(useAgentFlowStore.getState().userNode).toBeNull();
  });
});

// ── USER_NODE_ID constant ──────────────────────────────────────────────────

describe("USER_NODE_ID constant", () => {
  it("is exported from agentFlowStore with the expected value", () => {
    expect(USER_NODE_ID).toBe("user-node");
  });
});
