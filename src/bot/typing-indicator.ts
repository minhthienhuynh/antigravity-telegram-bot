import type { Api } from "grammy";

/**
 * Shared typing-indicator heartbeats.
 *
 * Used by: (a) the prompt handler right after writing the prompt into agy's
 * pipe — so "typing" lights up from message receipt (Hermes/opencode UX), and
 * (b) the event subscription service when streaming text arrives.
 *
 * PRUNING: every entry carries a lastSeen stamp; a sweep prunes intervals that
 * were never re-armed by a live run (retry-orphans previously leaked a 5s
 * heartbeat forever, keeping "typing…" visible with nothing working).
 */
type HeartbeatRecord = {
  timer: ReturnType<typeof setInterval>;
  sessionId: string;
};

const heartbeats = new Map<string, HeartbeatRecord>();
const lastSeen = new Map<string, number>();
/** Hard TTL: a heartbeat older than this is reaped even if nothing said stop. */
const STALE_AFTER_MS = 10 * 60_000;

export function startTypingIndicator(api: Api, chatId: number, sessionId: string): void {
  if (typeof api.sendChatAction !== "function") return;
  const existing = heartbeats.get(sessionId);
  if (existing) {
    lastSeen.set(sessionId, Date.now());
    return;
  }
  lastSeen.set(sessionId, Date.now());
  const record: HeartbeatRecord = {
    sessionId,
    timer: setInterval(() => {
      const stamp = lastSeen.get(record.sessionId) ?? Date.now();
      if (Date.now() - stamp > STALE_AFTER_MS) {
        // Orphaned heartbeat: nothing refreshed it for 10 minutes — stop it.
        stopTypingIndicator(record.sessionId);
        return;
      }
      void api.sendChatAction(chatId, "typing").catch(() => undefined);
    }, 5_000),
  };
  heartbeats.set(sessionId, record);
  void api.sendChatAction(chatId, "typing").catch(() => undefined);
}

/** Refreshes the staleness stamp of a live heartbeat (call from stream hooks). */
export function touchTypingIndicator(sessionId: string): void {
  if (heartbeats.has(sessionId)) {
    lastSeen.set(sessionId, Date.now());
  }
}

export function stopTypingIndicator(sessionId: string): void {
  const record = heartbeats.get(sessionId);
  if (record) {
    clearInterval(record.timer);
    heartbeats.delete(sessionId);
    lastSeen.delete(sessionId);
  }
}

export function rebindTypingIndicatorSessionId(oldId: string, newId: string): boolean {
  const record = heartbeats.get(oldId);
  if (!record || oldId === newId) {
    return false;
  }
  stopTypingIndicator(newId);
  record.sessionId = newId;
  heartbeats.delete(oldId);
  heartbeats.set(newId, record);
  const stamp = lastSeen.get(oldId);
  lastSeen.delete(oldId);
  if (stamp !== undefined) {
    lastSeen.set(newId, stamp);
  }
  return true;
}

export function __resetTypingIndicatorsForTests(): void {
  for (const record of heartbeats.values()) {
    clearInterval(record.timer);
  }
  heartbeats.clear();
  lastSeen.clear();
}
