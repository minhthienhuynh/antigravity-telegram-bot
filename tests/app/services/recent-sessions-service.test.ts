import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecentSessions } from "../../../src/app/services/recent-sessions-service.js";

const mocked = vi.hoisted(() => ({
  conversations: vi.fn(),
  attached: null as { id: string; directory: string } | null,
  project: null as { worktree: string } | null,
  busy: false,
}));
vi.mock("../../../src/antigravity/session-store.js", () => ({
  listConversations: mocked.conversations,
}));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentSession: () => mocked.attached,
  getCurrentProject: () => mocked.project,
}));
vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: () => mocked.busy,
}));

const conversation = (id: string, modified: number) => ({
  id,
  title: id,
  preview: "",
  lastModified: new Date(modified),
});

describe("agy recent session snapshot", () => {
  beforeEach(() => {
    mocked.attached = null;
    mocked.project = { worktree: "/repo" };
    mocked.busy = false;
    mocked.conversations.mockReset();
  });

  it("lists global conversations newest first under the current project label", async () => {
    mocked.conversations.mockResolvedValue([
      conversation("old", 2),
      conversation("new", 9),
      conversation("mid", 5),
    ]);

    const rows = await loadRecentSessions(10);

    expect(rows.map(({ session }) => session.id)).toEqual(["new", "mid", "old"]);
    expect(rows.every(({ session }) => session.directory === "/repo")).toBe(true);
    expect(rows.every(({ status }) => status === "idle")).toBe(true);
  });

  it("honours the limit after sorting", async () => {
    mocked.conversations.mockResolvedValue([
      conversation("a", 1),
      conversation("b", 3),
      conversation("c", 2),
    ]);

    expect((await loadRecentSessions(2)).map(({ session }) => session.id)).toEqual(["b", "c"]);
  });

  it("marks the attached conversation running only while the foreground is busy", async () => {
    mocked.attached = { id: "live", directory: "/repo" };
    mocked.conversations.mockResolvedValue([conversation("live", 5), conversation("other", 4)]);

    mocked.busy = true;
    expect((await loadRecentSessions(10)).map(({ status }) => status)).toEqual(["running", "idle"]);

    mocked.busy = false;
    expect((await loadRecentSessions(10)).map(({ status }) => status)).toEqual(["idle", "idle"]);
  });

  it("falls back to the attached directory then home when no project is selected", async () => {
    mocked.project = null;
    mocked.attached = { id: "x", directory: "/attached" };
    mocked.conversations.mockResolvedValue([conversation("x", 1)]);
    expect((await loadRecentSessions(10))[0]?.session.directory).toBe("/attached");

    mocked.attached = null;
    const rows = await loadRecentSessions(10);
    expect(typeof rows[0]?.session.directory).toBe("string");
  });

  it("returns an empty list when there are no conversations", async () => {
    mocked.conversations.mockResolvedValue([]);
    expect(await loadRecentSessions(10)).toEqual([]);
  });
});