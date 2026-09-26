import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "../db/testing";
import { removeApiKey, saveApiKey, testApiKey } from "./client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "./fake";
import { useAiStatus } from "./useAiStatus";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
  vi.restoreAllMocks();
});

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

describe("useAiStatus", () => {
  it("is no-key without a key", async () => {
    const { result } = renderHook(() => useAiStatus());
    await act(async () => {});
    expect(result.current).toEqual({ state: "no-key" });
  });

  it("is ready with a key and turns back to no-key when the key is removed", async () => {
    await saveApiKey("sk-ant-good");
    const { result } = renderHook(() => useAiStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "ready" }));
    await act(() => removeApiKey());
    await waitFor(() => expect(result.current).toEqual({ state: "no-key" }));
  });

  it("is unavailable while offline and ready again when back online", async () => {
    await saveApiKey("sk-ant-good");
    const { result } = renderHook(() => useAiStatus());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => setOnline(false));
    expect(result.current).toEqual({
      state: "unavailable",
      reason: expect.stringContaining("You are offline") as unknown,
    });
    act(() => setOnline(true));
    expect(result.current).toEqual({ state: "ready" });
  });

  it("is unavailable after the key is rejected, and ready after a later success", async () => {
    await saveApiKey("sk-ant-revoked");
    const { result } = renderHook(() => useAiStatus());
    await waitFor(() => expect(result.current.state).toBe("ready"));

    ai.queueError(fakeApiError(401, "authentication_error", "invalid x-api-key"));
    await act(() => testApiKey());
    await waitFor(() =>
      expect(result.current).toEqual({
        state: "unavailable",
        reason: "That key was not accepted. Check it was copied fully.",
      }),
    );

    ai.queueText("OK");
    await act(() => testApiKey());
    await waitFor(() => expect(result.current).toEqual({ state: "ready" }));
  });

  it("stays ready after a passing problem such as a rate limit", async () => {
    await saveApiKey("sk-ant-good");
    const { result } = renderHook(() => useAiStatus());
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    await act(() => testApiKey());
    await waitFor(() => expect(result.current).toEqual({ state: "ready" }));
  });
});
