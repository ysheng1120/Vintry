import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteSetting, getSetting, setSetting, useSetting } from "./settings";
import { resetDatabase } from "./testing";

describe("settings", () => {
  beforeEach(resetDatabase);

  it("returns the fallback until a value is set, and again after it is deleted", async () => {
    expect(await getSetting("theme", "system")).toBe("system");
    await setSetting("theme", "dark");
    expect(await getSetting("theme", "system")).toBe("dark");
    await deleteSetting("theme");
    expect(await getSetting("theme", "system")).toBe("system");
  });

  it("keeps structured values", async () => {
    await setSetting("onboardingDone", true);
    await setSetting("changesSinceBackup", 3);
    expect(await getSetting("onboardingDone", false)).toBe(true);
    expect(await getSetting("changesSinceBackup", 0)).toBe(3);
  });

  it("useSetting shows the fallback, then the live value", async () => {
    const { result } = renderHook(() => useSetting("currency", "GBP"));
    expect(result.current).toBe("GBP");
    await act(async () => {
      await setSetting("currency", "EUR");
    });
    await waitFor(() => expect(result.current).toBe("EUR"));
  });
});
