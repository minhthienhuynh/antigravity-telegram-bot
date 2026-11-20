import { EventEmitter, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

// Regression test for #12: sendPromptToActiveProcess must not reuse a live agy
// process running a DIFFERENT conversation after a session switch (/sessions,
// /recent) or a /new placeholder. It should recycle the stale process and
// spawn/resume the foreground conversation.

vi.mock("../../../src/app/managers/prompt-queue-manager.js", () => ({
  promptQueue: { clear: vi.fn() },
}));
vi.mock("../../../src/antigravity/session-store.js", () => ({
  getConversationTitle: () => "Real conversation title",
  conversationExists: () => true,
}));

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  spawn: spawnMock,
}));

function makeFakeChild() {
  const stdout = new EventEmitter() as unknown as Readable;
  Object.assign(stdout, { setEncoding: () => {}, resume: () => {}, pause: () => {}, readable: true });
  const stdin = {
    writes: [] as string[],
    end: vi.fn(),
    write: (chunk: string, cb?: (err?: Error) => void) => {
      stdin.writes.push(chunk);
      cb?.();
      return true;
    },
    writable: true,
  };
  const child = new EventEmitter() as Record<string, unknown>;
  child.stdout = stdout;
  child.stderr = { setEncoding: () => {}, on: () => {} };
  child.stdin = stdin;
  child.pid = 888;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

import {
  subscribeToEvents,
  sendPromptToActiveProcess,
  stopEventListening,
  __resetAgyEventsForTests,
} from "../../../src/antigravity/events.js";
import {
  setCurrentSession,
  clearSession,
} from "../../../src/app/stores/settings-store.js";

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("#12 recycle a stale live process on session switch", () => {
  afterEach(() => {
    stopEventListening();
    __resetAgyEventsForTests();
    clearSession();
    vi.restoreAllMocks();
  });

  it("spawns/resumes the foreground conversation instead of hijacking the old thread", async () => {
    setCurrentSession({ id: "agy-session-aaaa", title: "A", directory: "/tmp/proj" });
    const childA = makeFakeChild();
    spawnMock.mockImplementation(() => childA);
    await subscribeToEvents("/tmp/proj", () => {});
    await flush(1);
    (childA.stdout as unknown as EventEmitter).emit(
      "data",
      JSON.stringify({
        event: "init",
        conversation_id: "aaaa",
        init: { cwd: "/tmp/proj", tools: [], permission_mode: "default" },
      }) + "\n",
    );
    await flush(10);

    // User selects a different conversation (/sessions): foreground now B.
    setCurrentSession({ id: "agy-session-bbbb", title: "B", directory: "/tmp/proj" });
    const childB = makeFakeChild();
    spawnMock.mockImplementation(() => childB);
    await sendPromptToActiveProcess("continue B", "/tmp/proj");
    await flush(10);

    const lastArgs = spawnMock.mock.calls.at(-1)?.[1] as string[];
    expect(lastArgs).toContain("--conversation=bbbb");
    expect((childB.stdin as { writes: string[] }).writes.join("")).toContain("continue B");
    expect((childA.stdin as { writes: string[] }).writes.join("")).not.toContain("continue B");
  });

  it("still reuses the live process for a follow-up turn in the same conversation", async () => {
    setCurrentSession({ id: "agy-session-aaaa", title: "A", directory: "/tmp/proj" });
    const childA = makeFakeChild();
    spawnMock.mockImplementation(() => childA);
    await subscribeToEvents("/tmp/proj", () => {});
    await flush(1);
    (childA.stdout as unknown as EventEmitter).emit(
      "data",
      JSON.stringify({
        event: "init",
        conversation_id: "aaaa",
        init: { cwd: "/tmp/proj", tools: [], permission_mode: "default" },
      }) + "\n",
    );
    await flush(10);

    const callsBefore = spawnMock.mock.calls.length;
    await sendPromptToActiveProcess("follow up A", "/tmp/proj");
    await flush(10);

    // No respawn: the prompt went into the same live process.
    expect(spawnMock.mock.calls.length).toBe(callsBefore);
    expect((childA.stdin as { writes: string[] }).writes.join("")).toContain("follow up A");
  });
});