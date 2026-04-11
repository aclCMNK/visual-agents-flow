/**
 * tests/ui/agent-flow-store-slug.test.ts
 *
 * Unit tests for slug-first behavior in agentFlowStore:
 *   - commitPlacement: new agents get a slug name, not "New Agent"
 *   - renameAgent: applies toSlug transformation
 *   - updateAgent: applies toSlug transformation on the name field
 *
 * These are pure store logic tests — no DOM, no React.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { useAgentFlowStore } from "../../src/ui/store/agentFlowStore.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function resetStore() {
  useAgentFlowStore.getState().resetFlow();
}

// ── commitPlacement — slug-first ───────────────────────────────────────────

describe("agentFlowStore — commitPlacement creates slug name", () => {
  beforeEach(resetStore);

  it("creates agent with a slug name (not 'New Agent')", () => {
    useAgentFlowStore.getState().commitPlacement(100, 200);

    const agents = useAgentFlowStore.getState().agents;
    expect(agents).toHaveLength(1);
    // "new-agent" is reserved, so slugify produces "new-agent-2" (suffix added)
    // Actually: "new-agent" is reserved → first available would be "new-agent-2"
    const name = agents[0].name;
    // Must not be the raw "New Agent" string — must be slugified
    expect(name).not.toBe("New Agent");
    // Must only contain [a-z0-9-]
    expect(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name)).toBe(true);
  });

  it("creates unique slugs for each successive placement", () => {
    useAgentFlowStore.getState().commitPlacement(100, 100);
    useAgentFlowStore.getState().commitPlacement(200, 100);
    useAgentFlowStore.getState().commitPlacement(300, 100);

    const agents = useAgentFlowStore.getState().agents;
    expect(agents).toHaveLength(3);

    const names = agents.map((a) => a.name);
    // All names must be unique
    const unique = new Set(names);
    expect(unique.size).toBe(3);
  });

  it("marks the store dirty after placement", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    expect(useAgentFlowStore.getState().isDirty).toBe(true);
  });
});

// ── renameAgent — slug transformation ─────────────────────────────────────

describe("agentFlowStore — renameAgent applies toSlug", () => {
  beforeEach(resetStore);

  it("transforms a human name to a slug", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;

    useAgentFlowStore.getState().renameAgent(id, "My Cool Agent");

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    expect(agent?.name).toBe("my-cool-agent");
  });

  it("strips accents and special chars when renaming", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;

    useAgentFlowStore.getState().renameAgent(id, "Ágënt Böt!");

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    expect(agent?.name).toBe("agent-bot");
  });

  it("is a no-op for an empty/whitespace name", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;
    const originalName = useAgentFlowStore.getState().agents[0].name;

    useAgentFlowStore.getState().renameAgent(id, "   ");

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    // Name must not change when the slug resolves to empty
    expect(agent?.name).toBe(originalName);
  });
});

// ── updateAgent — slug transformation on name field ───────────────────────

describe("agentFlowStore — updateAgent applies toSlug to name", () => {
  beforeEach(resetStore);

  it("stores slug when name field is updated", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;

    useAgentFlowStore.getState().updateAgent(id, { name: "Mi Agente!" });

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    expect(agent?.name).toBe("mi-agente");
  });

  it("preserves existing slug when name is not in the update fields", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().renameAgent(id, "my-agent");
    const nameBefore = useAgentFlowStore.getState().agents.find((a) => a.id === id)!.name;

    // Update only description — name must not change
    useAgentFlowStore.getState().updateAgent(id, { description: "Some desc" });

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    expect(agent?.name).toBe(nameBefore);
    expect(agent?.description).toBe("Some desc");
  });

  it("falls back to existing name when slug resolves to empty", () => {
    useAgentFlowStore.getState().commitPlacement(0, 0);
    const id = useAgentFlowStore.getState().agents[0].id;
    useAgentFlowStore.getState().renameAgent(id, "valid-agent");
    const nameBefore = useAgentFlowStore.getState().agents.find((a) => a.id === id)!.name;

    // Update with a string that resolves to an empty slug
    useAgentFlowStore.getState().updateAgent(id, { name: "!!!" });

    const agent = useAgentFlowStore.getState().agents.find((a) => a.id === id);
    expect(agent?.name).toBe(nameBefore);
  });
});
