import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBrowser,
  detectOs,
  getPlatform,
  isSafariOnMac,
  isStandalone,
  resetInstallPromptForTests,
  useInstallPrompt,
} from "./platform";

const UA = {
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:129.0) Gecko/20100101 Firefox/129.0",
};

function fakeMatchMedia(standalone: boolean) {
  return ((query: string) => ({
    matches: standalone && query.includes("display-mode: standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** A `beforeinstallprompt` event as Chrome and Edge fire it. */
function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetInstallPromptForTests();
});

describe("browser and OS detection", () => {
  it("recognises Safari on macOS and nothing else as Safari", () => {
    expect(isSafariOnMac(UA.safariMac)).toBe(true);
    expect(isSafariOnMac(UA.chromeMac)).toBe(false);
    expect(isSafariOnMac(UA.firefoxMac)).toBe(false);
    expect(isSafariOnMac(UA.edgeWindows)).toBe(false);
  });

  it("tells Chrome, Edge, Firefox, and Safari apart", () => {
    expect(detectBrowser(UA.chromeMac)).toBe("chrome");
    expect(detectBrowser(UA.chromeWindows)).toBe("chrome");
    expect(detectBrowser(UA.edgeWindows)).toBe("edge");
    expect(detectBrowser(UA.firefoxMac)).toBe("firefox");
    expect(detectBrowser(UA.safariMac)).toBe("safari");
  });

  it("detects macOS and Windows", () => {
    expect(detectOs(UA.safariMac)).toBe("mac");
    expect(detectOs(UA.edgeWindows)).toBe("windows");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });

  it("reports standalone (installed) display mode", () => {
    window.matchMedia = fakeMatchMedia(true);
    expect(isStandalone()).toBe(true);
    window.matchMedia = fakeMatchMedia(false);
    expect(isStandalone()).toBe(false);
  });

  it("combines the checks for the current browser", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.safariMac);
    window.matchMedia = fakeMatchMedia(false);
    expect(getPlatform()).toEqual({
      os: "mac",
      browser: "safari",
      safariOnMac: true,
      standalone: false,
    });
  });
});

describe("install prompt store", () => {
  it("captures the browser's install prompt and offers it once", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.available).toBe(false);

    const event = installPromptEvent("accepted");
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.available).toBe(true);

    let outcome = "";
    await act(async () => {
      outcome = await result.current.promptInstall();
    });
    expect(outcome).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // A prompt can be used only once.
    expect(result.current.available).toBe(false);
  });

  it("says unavailable when the browser never offered a prompt", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let outcome = "";
    await act(async () => {
      outcome = await result.current.promptInstall();
    });
    expect(outcome).toBe("unavailable");
  });

  it("forgets the prompt once the app is installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(installPromptEvent("dismissed"));
    });
    expect(result.current.available).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.available).toBe(false);
    expect(result.current.installed).toBe(true);
  });
});
