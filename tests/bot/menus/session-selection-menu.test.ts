import { describe, expect, it } from "vitest";

import { parseWorkspaceUris } from "../../../src/antigravity/session-store.js";
import {
  filterConversationsForDirectory,
  workspaceBelongsToDirectory,
} from "../../../src/bot/menus/session-selection-menu.js";
import type { AntigravityConversation } from "../../../src/antigravity/session-store.js";

function conversation(overrides: Partial<AntigravityConversation> = {}): AntigravityConversation {
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    title: "Conversation",
    preview: "",
    lastModified: new Date("2026-11-16T08:00:00Z"),
    workspaces: [],
    parentConversationId: null,
    ...overrides,
  };
}

describe("parseWorkspaceUris", () => {
  it("maps file:// URIs to absolute paths", () => {
    expect(parseWorkspaceUris('["file:///home/ubuntu/projects"]')).toEqual([
      "/home/ubuntu/projects",
    ]);
  });

  it("returns [] for null, empty, or malformed payloads", () => {
    expect(parseWorkspaceUris(null)).toEqual([]);
    expect(parseWorkspaceUris("")).toEqual([]);
    expect(parseWorkspaceUris("not json")).toEqual([]);
    expect(parseWorkspaceUris('{"a":1}')).toEqual([]);
  });

  it("keeps non-file and unparseable entries verbatim", () => {
    expect(parseWorkspaceUris('["ssh://host/path","file:///a b/c"]')).toEqual([
      "ssh://host/path",
      "/a b/c",
    ]);
  });
});

describe("workspaceBelongsToDirectory", () => {
  it("matches the directory itself and descendants", () => {
    expect(workspaceBelongsToDirectory("/repo", "/repo")).toBe(true);
    expect(workspaceBelongsToDirectory("/repo/sub/dir", "/repo")).toBe(true);
  });

  it("does not match sibling or parent paths", () => {
    expect(workspaceBelongsToDirectory("/repository", "/repo")).toBe(false);
    expect(workspaceBelongsToDirectory("/other", "/repo")).toBe(false);
    expect(workspaceBelongsToDirectory("/repo", "/repo/sub")).toBe(false);
  });
});

describe("filterConversationsForDirectory", () => {
  const inProject = conversation({
    id: "in-project",
    workspaces: ["/repo"],
  });
  const inSubdir = conversation({
    id: "in-subdir",
    workspaces: ["/repo/sub"],
  });
  const elsewhere = conversation({
    id: "elsewhere",
    workspaces: ["/other/place"],
  });
  const noWorkspace = conversation({ id: "no-workspace" });
  const subagent = conversation({
    id: "subagent",
    workspaces: ["/repo"],
    parentConversationId: "in-project",
  });

  it("keeps workspace-matched conversations first and drops subagents", () => {
    const filtered = filterConversationsForDirectory(
      [noWorkspace, subagent, elsewhere, inSubdir, inProject],
      "/repo",
    );
    expect(filtered.map((c) => c.id)).toEqual(["in-subdir", "in-project", "no-workspace"]);
  });

  it("appends conversations with no workspace info instead of dropping them", () => {
    const filtered = filterConversationsForDirectory([noWorkspace], "/repo");
    expect(filtered.map((c) => c.id)).toEqual(["no-workspace"]);
  });

  it("excludes conversations recorded in other workspaces", () => {
    const filtered = filterConversationsForDirectory([elsewhere], "/repo");
    expect(filtered).toEqual([]);
  });

  it("is defensive against conversations missing the new fields", () => {
    const legacy = { id: "legacy", title: "t", preview: "", lastModified: new Date() } as unknown as AntigravityConversation;
    expect(filterConversationsForDirectory([legacy], "/repo").map((c) => c.id)).toEqual(["legacy"]);
  });
});
