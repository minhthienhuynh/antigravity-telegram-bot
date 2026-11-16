import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";

import { attachManager } from "../../../src/app/managers/attach-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import { assistantRunState } from "../../../src/app/managers/assistant-run-state-manager.js";
import { externalUserInputSuppressionManager } from "../../../src/app/managers/external-input-suppression-manager.js";
import { summaryAggregator } from "../../../src/app/managers/summary-aggregation-manager.js";
import * as typingIndicator from "../../../src/bot/typing-indicator.js";
import {
  getPromptResponseModeRebinder,
  rebindSessionRuntimeId,
  setPromptResponseModeRebinder,
} from "../../../src/app/services/session-runtime-rebind-service.js";

describe("rebindSessionRuntimeId", () => {
  let initialRebinder: ((oldId: string, newId: string) => void) | null = null;

  beforeAll(() => {
    initialRebinder = getPromptResponseModeRebinder();
  });

  afterAll(() => {
    setPromptResponseModeRebinder(initialRebinder);
    typingIndicator.__resetTypingIndicatorsForTests();
  });

  beforeEach(() => {
    attachManager.__resetForTests();
    foregroundSessionState.__resetForTests();
    assistantRunState.__resetForTests();
    externalUserInputSuppressionManager.__resetForTests();
    typingIndicator.__resetTypingIndicatorsForTests();
    setPromptResponseModeRebinder(null);
  });

  it("migrates the attached busy latch to the new runtime id", () => {
    attachManager.attach("new-1794816042820", "/home/ubuntu/projects");
    expect(attachManager.markBusy("new-1794816042820")).toBe(true);

    expect(rebindSessionRuntimeId("new-1794816042820", "agy-session-1c427347")).toBe(true);

    // The busy state followed the rebind: idle with the REAL id releases it.
    expect(attachManager.isBusy()).toBe(true);
    expect(attachManager.markIdle("agy-session-1c427347")).toBe(true);
    expect(attachManager.isBusy()).toBe(false);
    expect(attachManager.getSnapshot()?.sessionId).toBe("agy-session-1c427347");
  });

  it("migrates the foreground busy entry so the closing idle releases it", () => {
    attachManager.attach("new-1794816042820", "/home/ubuntu/projects");
    foregroundSessionState.markBusy("new-1794816042820", "/home/ubuntu/projects");
    rebindSessionRuntimeId("new-1794816042820", "agy-session-1c427347");

    expect(foregroundSessionState.isBusy()).toBe(true);
    foregroundSessionState.markIdle("agy-session-1c427347");
    expect(foregroundSessionState.isBusy()).toBe(false);
  });

  it("migrates an in-flight assistant run", () => {
    assistantRunState.startRun("new-1794816042820", {
      startedAt: Date.now(),
      configuredAgent: "build",
      configuredModelID: "gemini-3.8-flash-high",
    });
    rebindSessionRuntimeId("new-1794816042820", "agy-session-1c427347");

    expect(assistantRunState.hasActiveRun()).toBe(true);
    assistantRunState.clearRun("agy-session-1c427347", "test");
    expect(assistantRunState.hasActiveRun()).toBe(false);
  });

  it("repoints the registered prompt-response-mode rebinder", () => {
    const migrated: Array<[string, string]> = [];
    setPromptResponseModeRebinder((oldId, newId) => {
      migrated.push([oldId, newId]);
    });

    rebindSessionRuntimeId("new-1", "agy-session-a");
    expect(migrated).toEqual([["new-1", "agy-session-a"]]);
  });

  it("rebindSessionRuntimeId delegates to externalUserInputSuppressionManager and typingIndicator", () => {
    const suppressionSpy = vi.spyOn(externalUserInputSuppressionManager, "rebindSessionId");
    const typingSpy = vi.spyOn(typingIndicator, "rebindTypingIndicatorSessionId");
    const summarySpy = vi.spyOn(summaryAggregator, "setSession");

    externalUserInputSuppressionManager.register("new-1", "Hello prompt");
    const sendChatAction = vi.fn().mockResolvedValue(true);
    typingIndicator.startTypingIndicator({ sendChatAction } as unknown as Api, 12345, "new-1");

    expect(rebindSessionRuntimeId("new-1", "agy-session-xyz")).toBe(true);

    expect(suppressionSpy).toHaveBeenCalledWith("new-1", "agy-session-xyz");
    expect(typingSpy).toHaveBeenCalledWith("new-1", "agy-session-xyz");
    expect(summarySpy).toHaveBeenCalledWith("agy-session-xyz");

    expect(externalUserInputSuppressionManager.consume("agy-session-xyz", "Hello prompt")).toBe(true);

    suppressionSpy.mockRestore();
    typingSpy.mockRestore();
    summarySpy.mockRestore();
  });

  it("preserves and restores promptResponseModeRebinder across test lifecycle", () => {
    const dummyRebinder = (_oldId: string, _newId: string) => {};
    setPromptResponseModeRebinder(dummyRebinder);
    expect(getPromptResponseModeRebinder()).toBe(dummyRebinder);

    setPromptResponseModeRebinder(null);
    expect(getPromptResponseModeRebinder()).toBeNull();
  });

  it("is a no-op for identical or empty ids", () => {
    attachManager.attach("agy-session-x", "/home/ubuntu/projects");
    expect(rebindSessionRuntimeId("agy-session-x", "agy-session-x")).toBe(false);
    expect(rebindSessionRuntimeId("", "agy-session-x")).toBe(false);
    expect(attachManager.getSnapshot()?.sessionId).toBe("agy-session-x");
  });
});
