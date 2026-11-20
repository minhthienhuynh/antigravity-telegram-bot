import { logger } from "../../utils/logger.js";

export interface ForegroundBusySession {
  sessionId: string;
  directory: string;
  markedAt: number;
}

class ForegroundSessionState {
  private activeSessions = new Map<string, ForegroundBusySession>();

  markBusy(sessionId: string, directory: string): void {
    if (!sessionId || !directory) {
      return;
    }

    this.activeSessions.set(sessionId, { sessionId, directory, markedAt: Date.now() });
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: session=${sessionId}, directory=${directory}, count=${this.activeSessions.size}`,
    );
  }

  markIdle(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    this.activeSessions.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: session=${sessionId}, count=${this.activeSessions.size}`,
    );
  }

  /**
   * Move a busy entry to a new runtime id (placeholder -> real conversation
   * id) so the closing session.idle — which carries the real id — releases it.
   */
  rebindSessionId(oldId: string, newId: string): boolean {
    const entry = this.activeSessions.get(oldId);
    if (!entry || oldId === newId) {
      return false;
    }

    this.activeSessions.delete(oldId);
    this.activeSessions.set(newId, { ...entry, sessionId: newId });
    logger.info(
      `[ScheduledTaskForeground] Rebound busy session: session=${oldId} -> ${newId}, count=${this.activeSessions.size}`,
    );
    return true;
  }

  getBusySessions(): ForegroundBusySession[] {
    return Array.from(this.activeSessions.values(), (session) => ({ ...session }));
  }

  isBusy(): boolean {
    return this.activeSessions.size > 0;
  }

  clearAll(reason: string): void {
    if (this.activeSessions.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, count=${this.activeSessions.size}`,
    );
    this.activeSessions.clear();
  }

  __resetForTests(): void {
    this.activeSessions.clear();
  }

  __setMarkedAtForTests(sessionId: string, markedAt: number): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    this.activeSessions.set(sessionId, { ...session, markedAt });
  }
}

export const foregroundSessionState = new ForegroundSessionState();
