import { EventEmitter, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

// A follow-up turn on a live agy process emits no fresh `init`. The result
// envelope still carries conversation_id, and handleResult must reconcile the
// /new placeholder ("new-…") to that real conversation — otherwise the delivery
// events mismatch the stored placeholder and the reply is never sent.

vi.mock("../../../src/app/services/prompt-inbox-service.js", () => ({
  withdrawPromptQueue: vi.fn(async () => undefined),
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
  stopEventListening,
  __resetAgyEventsForTests,
} from "../../../src/antigravity/events.js";
import {
  setCurrentSession,
  getCurrentSession,
  clearSession,
} from "../../../src/app/stores/settings-store.js";

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("result reconciles a /new placeholder (follow-up turn, no init)", () => {
  afterEach(() => {
    stopEventListening();
    __resetAgyEventsForTests();
    clearSession();
    vi.restoreAllMocks();
  });

  it("promotes the placeholder to the result conversation and delivers under it", async () => {
    setCurrentSession({ id: "new-1795145227594", title: "New conversation", directory: "/tmp/proj" });
    const child = makeFakeChild();
    spawnMock.mockImplementation(() => child);

    const events: Array<{ type: string; properties: Record<string, unknown> }> = [];
    await subscribeToEvents("/tmp/proj", (e) => {
      events.push({ type: e.type, properties: e.properties as Record<string, unknown> });
    });
    await flush(1);

    // No init line: simulate a follow-up turn whose result carries the real id.
    const stdout = child.stdout as unknown as EventEmitter;
    stdout.emit(
      "data",
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "6c34a899-ede8-412e-b7fc-914061d09732",
          status: "SUCCESS",
          response: "Báo cáo hoàn tất.",
          num_turns: 1,
        },
      }) + "\n",
    );
    await flush(30);

    // Placeholder promoted to the real conversation id.
    expect(getCurrentSession()?.id).toBe("agy-session-6c34a899-ede8-412e-b7fc-914061d09732");
    // Delivery events carry the reconciled id (so the foreground guard matches).
    const updated = events.find((e) => e.type === "message.updated");
    const idle = events.find((e) => e.type === "session.idle");
    expect((updated?.properties.info as { sessionID: string }).sessionID).toBe(
      "agy-session-6c34a899-ede8-412e-b7fc-914061d09732",
    );
    expect(idle?.properties.sessionID).toBe("agy-session-6c34a899-ede8-412e-b7fc-914061d09732");
  });
});