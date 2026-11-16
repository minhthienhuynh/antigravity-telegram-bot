import { logger } from "../../utils/logger.js";
import { attachManager } from "../managers/attach-manager.js";
import { foregroundSessionState } from "../managers/foreground-session-state-manager.js";
import { assistantRunState } from "../managers/assistant-run-state-manager.js";
import { externalUserInputSuppressionManager } from "../managers/external-input-suppression-manager.js";
import { summaryAggregator } from "../managers/summary-aggregation-manager.js";
import { rebindTypingIndicatorSessionId } from "../../bot/typing-indicator.js";

type PromptResponseModeRebinder = (oldId: string, newId: string) => void;

/**
 * Registered by the prompt handler so the response-mode map (kept inside
 * prompt.ts to avoid an import cycle) can follow the rebind too.
 */
let promptResponseModeRebinder: PromptResponseModeRebinder | null = null;

export function setPromptResponseModeRebinder(
  rebinder: PromptResponseModeRebinder | null,
): void {
  promptResponseModeRebinder = rebinder;
}

export function getPromptResponseModeRebinder(): PromptResponseModeRebinder | null {
  return promptResponseModeRebinder;
}

/**
 * Rebind every runtime state keyed by session id from `oldId` to `newId`.
 *
 * Why this exists: the stored/settings session can carry a `new-<ts>`
 * placeholder (created by /new or the pinned dashboard) while the agy runtime
 * reports the real conversation id only via the `init` event of a fresh
 * process. Promotion (session-service) fixes the stored id, but the runtime
 * managers (attach latch, foreground busy, assistant run, echo suppression,
 * summary aggregator) keep the OLD id — the turn's closing `session.idle`
 * carries the real id, never matches, and the busy latch sticks until the
 * whole bot is restarted.
 */
export function rebindSessionRuntimeId(oldId: string, newId: string): boolean {
  if (!oldId || !newId || oldId === newId) {
    return false;
  }

  logger.info(`[SessionRebind] runtime id changed: ${oldId} -> ${newId}; rebinding id-keyed state`);
  attachManager.rebindSessionId(oldId, newId);
  foregroundSessionState.rebindSessionId(oldId, newId);
  assistantRunState.rebindSessionId(oldId, newId);
  externalUserInputSuppressionManager.rebindSessionId(oldId, newId);
  // The aggregator tracks the id its session.idle matcher compares against;
  // at init time (fresh turn, empty buffers) repointing it is safe.
  summaryAggregator.setSession(newId);
  promptResponseModeRebinder?.(oldId, newId);
  rebindTypingIndicatorSessionId(oldId, newId);
  return true;
}
