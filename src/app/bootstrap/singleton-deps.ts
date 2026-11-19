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
