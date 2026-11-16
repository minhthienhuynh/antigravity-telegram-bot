import { logger } from "../../utils/logger.js";

export interface AttachedSessionState {
  sessionId: string;
  directory: string;
  busy: boolean;
}

class AttachManager {
  private state: AttachedSessionState | null = null;

  attach(sessionId: string, directory: string): void {
    this.state = {
      sessionId,
      directory,
      busy: false,
    };

    logger.info(`[Attach] Attached to session: session=${sessionId}, directory=${directory}`);
  }

  clear(reason: string): void {
    if (!this.state) {
      return;
    }

    logger.info(
      `[Attach] Cleared attached session: reason=${reason}, session=${this.state.sessionId}, directory=${this.state.directory}`,
    );
    this.state = null;
  }

  getSnapshot(): AttachedSessionState | null {
    return this.state ? { ...this.state } : null;
  }

  isAttached(): boolean {
    return this.state !== null;
  }

  isAttachedSession(sessionId: string | null | undefined, directory?: string): boolean {
    if (!this.state || !sessionId) {
      return false;
    }

    if (this.state.sessionId !== sessionId) {
      return false;
    }

    if (directory && this.state.directory !== directory) {
      return false;
    }

    return true;
  }

  isBusy(): boolean {
    return this.state?.busy === true;
  }

  markBusy(sessionId: string): boolean {
    if (!this.state || this.state.sessionId !== sessionId) {
      return false;
    }

    if (this.state.busy) {
      return false;
    }

    this.state.busy = true;
    logger.info(`[Attach] Marked attached session busy: session=${sessionId}`);
    return true;
  }

  markIdle(sessionId: string): boolean {
    if (!this.state || this.state.sessionId !== sessionId) {
      return false;
    }

    if (!this.state.busy) {
      return false;
    }

    this.state.busy = false;
    logger.info(`[Attach] Marked attached session idle: session=${sessionId}`);
    return true;
  }

  /**
   * Migrate the attached session to a new runtime id (e.g. a `new-<ts>`
   * placeholder promoted to the real agy conversation id on init). Keeping the
   * attached id in sync is what lets session.idle release the busy latch.
   */
  rebindSessionId(oldId: string, newId: string): boolean {
    if (!this.state || this.state.sessionId !== oldId || oldId === newId) {
      return false;
    }

    this.state.sessionId = newId;
    logger.info(`[Attach] Rebound attached session id: ${oldId} -> ${newId}`);
    return true;
  }

  __resetForTests(): void {
    this.state = null;
  }
}

export const attachManager = new AttachManager();
