import { describe, expect, it, vi } from "vitest";

import {
  listConversations,
  parseWorkspaceUris,
} from "../../../src/antigravity/session-store.js";
import {
  filterConversationsForDirectory,
  loadSessionPage,
  workspaceBelongsToDirectory,
} from "../../../src/bot/menus/session-selection-menu.js";
import type { AntigravityConversation } from "../../../src/antigravity/session-store.js";

vi.mock("../../../src/antigravity/session-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/antigravity/session-store.js")>();
  return {
    ...actual,
    listConversations: vi.fn(),
  };
});

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

  it("discards non-file URIs and relative paths", () => {
    expect(
      parseWorkspaceUris('["ssh://host/path", "file:///a b/c", "./relative/path"]'),
    ).toEqual(["/a b/c"]);
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

  it("matches root directories correctly on POSIX and Windows", () => {
    expect(workspaceBelongsToDirectory("/repo/sub", "/")).toBe(true);
    expect(workspaceBelongsToDirectory("/", "/")).toBe(true);
    expect(workspaceBelongsToDirectory("C:\\Users\\project", "C:\\")).toBe(true);
    expect(workspaceBelongsToDirectory("C:\\", "C:\\")).toBe(true);
  });

  it("handles Windows case-insensitivity and drive letters", () => {
    expect(workspaceBelongsToDirectory("c:\\projects\\repo", "C:\\Projects\\Repo")).toBe(true);
    expect(workspaceBelongsToDirectory("c:\\projects\\repo\\sub", "C:\\Projects\\Repo")).toBe(true);
    expect(workspaceBelongsToDirectory("d:\\projects\\repo", "C:\\projects\\repo")).toBe(false);
  });

  it("handles trailing slashes and redundant segments", () => {
    expect(workspaceBelongsToDirectory("/repo/sub/", "/repo")).toBe(true);
    expect(workspaceBelongsToDirectory("/repo/sub", "/repo/")).toBe(true);
  });

  it("rejects non-absolute paths and URIs defensively", () => {
    expect(workspaceBelongsToDirectory("ssh://host/path", "/repo")).toBe(false);
    expect(workspaceBelongsToDirectory("relative/path", "/repo")).toBe(false);
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

  it("places fresh conversations with no workspace info at the top of the list when newest", () => {
    const olderOwned = conversation({
      id: "older-owned",
      workspaces: ["/repo"],
      lastModified: new Date(1000),
    });
    const freshUnknown = conversation({
      id: "fresh-unknown",
      workspaces: [],
      lastModified: new Date(2000),
    });
    const filtered = filterConversationsForDirectory([olderOwned, freshUnknown], "/repo");
    expect(filtered.map((c) => c.id)).toEqual(["fresh-unknown", "older-owned"]);
  });

  it("interleaves unknown conversations chronologically rather than appending them to the end", () => {
    const unknownNew = conversation({
      id: "unknown-new",
      workspaces: [],
      lastModified: new Date(3000),
    });
    const ownedMiddle = conversation({
      id: "owned-middle",
      workspaces: ["/repo"],
      lastModified: new Date(2000),
    });
    const unknownOld = conversation({
      id: "unknown-old",
      workspaces: [],
      lastModified: new Date(1000),
    });
    const filtered = filterConversationsForDirectory(
      [ownedMiddle, unknownNew, unknownOld],
      "/repo",
    );
    expect(filtered.map((c) => c.id)).toEqual(["unknown-new", "owned-middle", "unknown-old"]);
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

describe("loadSessionPage", () => {
  it("correctly slices pages and sets hasNext flag", async () => {
    const listConversationsMock = vi.mocked(listConversations);
    const mockConversations = Array.from({ length: 12 }, (_, i) =>
      conversation({
        id: `conv-${i + 1}`,
        workspaces: ["/repo"],
        lastModified: new Date(10000 - i * 100),
      }),
    );
    listConversationsMock.mockResolvedValue(mockConversations);

    const page0 = await loadSessionPage("/repo", 0, 5);
    expect(page0.sessions).toHaveLength(5);
    expect(page0.hasNext).toBe(true);
    expect(page0.page).toBe(0);
    expect(page0.sessions[0]?.id).toBe("conv-1");
    expect(page0.sessions[4]?.id).toBe("conv-5");

    const page1 = await loadSessionPage("/repo", 1, 5);
    expect(page1.sessions).toHaveLength(5);
    expect(page1.hasNext).toBe(true);
    expect(page1.page).toBe(1);
    expect(page1.sessions[0]?.id).toBe("conv-6");
    expect(page1.sessions[4]?.id).toBe("conv-10");

    const page2 = await loadSessionPage("/repo", 2, 5);
    expect(page2.sessions).toHaveLength(2);
    expect(page2.hasNext).toBe(false);
    expect(page2.page).toBe(2);
    expect(page2.sessions[0]?.id).toBe("conv-11");
    expect(page2.sessions[1]?.id).toBe("conv-12");
  });
});
