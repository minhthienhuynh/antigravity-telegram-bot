import { clearAllInteractionState } from "../managers/interaction-reset.js";
import { attachManager } from "../managers/attach-manager.js";
import { foregroundSessionState } from "../managers/foreground-session-state-manager.js";
import { interactionManager } from "../managers/interaction-manager.js";
import { permissionManager } from "../managers/permission-manager.js";
import { questionManager } from "../managers/question-manager.js";
import { summaryAggregator } from "../managers/summary-aggregation-manager.js";
import { assistantRunState } from "../managers/assistant-run-state-manager.js";
import { keyboardManager } from "../../bot/keyboards/keyboard-manager.js";
import { renameManager } from "../managers/rename-manager.js";
import { pinnedMessageManager } from "../../bot/pinned/pinned-message-manager.js";
import { scheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";
import { backgroundSessionTracker } from "../managers/background-session-manager.js";
import { externalUserInputSuppressionManager } from "../managers/external-input-suppression-manager.js";
import { taskCreationManager } from "../managers/scheduled-task-creation-manager.js";
import { OpencodeAutoRestartService } from "../../opencode/auto-restart.js";
import { OpencodeReadyLifecycle } from "../../opencode/ready-lifecycle.js";
import type { AppContainer } from "./app-container.js";
import type { Bot, Context } from "grammy";

/** Deps bundles built from the process-wide singletons (shared with appContainer). */
export const busyDeps = { attachManager, foregroundSessionState };
export const busyReconcileDeps = { attachManager, foregroundSessionState, scheduledTaskRuntime };
export const detachDeps = { attachManager, resetAggregator: () => summaryAggregator.clear() };
export const inlineMenuDeps = { interactionManager };
export const permissionMenuDeps = { interactionManager, permissionManager, summaryAggregator };
export const questionMenuDeps = { interactionManager, questionManager };
export const renameDeps = { interactionManager, renameManager, pinnedMessageManager };
export const abortDeps = { assistantRunState, attachManager, foregroundSessionState, resetInteractions: clearAllInteractionState };
export const attachPresentationFactoryDeps = { keyboardManager, pinnedMessageManager, ...permissionMenuDeps, ...questionMenuDeps };
export const attachSessionDeps = { attachManager, permissionManager, questionManager, summaryAggregator, interactionManager };
export const attachRestoreDeps = { ...attachSessionDeps, pinnedMessageManager };

/**
 * AppContainer-shaped bundle over the process-wide singletons. Used as the
 * default deps for handlers invoked outside the container wiring (tests,
 * direct calls); production code passes the real container.
 */
/** Dormant OpenCode lifecycle: no server to watch on the agy backend. */
const placeholderReadyLifecycle = new OpencodeReadyLifecycle();

/** Pass-through placeholder: touching it outside real wiring is a bug. */
const placeholderBot = new Proxy({} as Bot<Context>, {
  get: () => {
    throw new Error("containerDeps.bot is not wired; pass the bot explicitly");
  },
});

export const containerDeps: AppContainer & { bot: Bot<Context> } = {
  bot: placeholderBot,
  assistantRunState,
  attachManager,
  backgroundSessionTracker,
  externalUserInputSuppressionManager,
  foregroundSessionState,
  interactionManager,
  keyboardManager,
  opencodeAutoRestartService: new OpencodeAutoRestartService(placeholderReadyLifecycle),
  opencodeReadyLifecycle: placeholderReadyLifecycle,
  permissionManager,
  pinnedMessageManager,
  questionManager,
  renameManager,
  scheduledTaskRuntime,
  summaryAggregator,
  taskCreationManager,
  ensureEventSubscription: async (directory: string) => {
    const { eventSubscriptionService } = await import("../../bot/services/event-subscription-service.js");
    await eventSubscriptionService.ensureEventSubscription(directory);
  },
  setTelegramContext: (bot, chatId) => {
    void import("../../bot/services/event-subscription-service.js").then((m) =>
      m.eventSubscriptionService.setTelegramContext(bot, chatId),
    );
  },
  startHeartbeat: () => {},
  setReadyRestoreHandler: () => {},
  resetInteractions: (reason: string) => clearAllInteractionState(reason),
  resetInteractionError: (_scope, reason) => clearAllInteractionState(reason),
  resetAggregator: () => summaryAggregator.clear(),
  resetRuntimeStreams: () => {},
  cleanupProcess: () => {},
};
