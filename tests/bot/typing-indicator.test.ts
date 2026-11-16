import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import {
  startTypingIndicator,
  stopTypingIndicator,
  rebindTypingIndicatorSessionId,
  __resetTypingIndicatorsForTests,
} from "../../src/bot/typing-indicator.js";

describe("typing-indicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetTypingIndicatorsForTests();
  });

  afterEach(() => {
    __resetTypingIndicatorsForTests();
    vi.useRealTimers();
  });

  it("rebindTypingIndicatorSessionId moves active heartbeat to new session ID", () => {
    const sendChatAction = vi.fn().mockResolvedValue(true);
    const api = { sendChatAction } as unknown as Api;

    startTypingIndicator(api, 12345, "new-1");
    expect(sendChatAction).toHaveBeenCalledTimes(1);
    expect(sendChatAction).toHaveBeenCalledWith(12345, "typing");

    // Advance 5s, heartbeat pulses
    vi.advanceTimersByTime(5_000);
    expect(sendChatAction).toHaveBeenCalledTimes(2);

    // Rebind from new-1 to agy-session-1
    const rebound = rebindTypingIndicatorSessionId("new-1", "agy-session-1");
    expect(rebound).toBe(true);

    // Advance another 5s, rebound heartbeat pulses
    vi.advanceTimersByTime(5_000);
    expect(sendChatAction).toHaveBeenCalledTimes(3);

    // stopTypingIndicator on old ID is a no-op now
    stopTypingIndicator("new-1");
    vi.advanceTimersByTime(5_000);
    expect(sendChatAction).toHaveBeenCalledTimes(4);
  });

  it("stopTypingIndicator on promoted ID cancels the rebound heartbeat", () => {
    const sendChatAction = vi.fn().mockResolvedValue(true);
    const api = { sendChatAction } as unknown as Api;

    startTypingIndicator(api, 12345, "new-1");
    rebindTypingIndicatorSessionId("new-1", "agy-session-1");

    // Stopping promoted ID should stop further chat actions
    stopTypingIndicator("agy-session-1");

    sendChatAction.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  it("rebindTypingIndicatorSessionId returns false when oldId does not exist", () => {
    expect(rebindTypingIndicatorSessionId("nonexistent", "agy-session-1")).toBe(false);
    expect(rebindTypingIndicatorSessionId("new-1", "new-1")).toBe(false);
  });
});
