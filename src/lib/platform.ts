import { useSyncExternalStore } from "react";

/**
 * Browser and install checks for onboarding (R26, R28). Vintry targets Windows and macOS
 * desktops only, so the checks cover Chrome, Edge, Safari, and Firefox there.
 */

export type BrowserKind = "chrome" | "edge" | "safari" | "firefox" | "other";
export type OsKind = "mac" | "windows" | "other";

export interface PlatformInfo {
  os: OsKind;
  browser: BrowserKind;
  /** Safari on a Mac: it can evict tab data after 7 days, so onboarding asks for Add to Dock. */
  safariOnMac: boolean;
  /** Running as an installed app (its own window), not in a browser tab. */
  standalone: boolean;
}

export function detectBrowser(userAgent: string): BrowserKind {
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "firefox";
  // Opera, Brave, and other Chromium browsers report "Chrome/" and can install apps the same way.
  if (/Chrome\/|Chromium\/|CriOS/.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "safari";
  return "other";
}

export function detectOs(userAgent: string): OsKind {
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  if (/Windows/.test(userAgent)) return "windows";
  return "other";
}

export function isSafariOnMac(userAgent: string): boolean {
  return detectOs(userAgent) === "mac" && detectBrowser(userAgent) === "safari";
}

/** True when Vintry runs as an installed app (Chrome/Edge app window or a Safari Dock app). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)").matches
    : false;
}

export function getPlatform(): PlatformInfo {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return {
    os: detectOs(ua),
    browser: detectBrowser(ua),
    safariOnMac: isSafariOnMac(ua),
    standalone: isStandalone(),
  };
}

// ---- The browser's install prompt (Chrome and Edge) ----

/** Chrome and Edge fire `beforeinstallprompt` when the app can be installed. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

const store = {
  event: null as InstallPromptEvent | null,
  installed: false,
  version: 0,
};
const listeners = new Set<() => void>();

function changed() {
  store.version += 1;
  for (const listener of listeners) listener();
}

function onBeforeInstallPrompt(event: Event) {
  // Keep the event so the onboarding "Install app" button can show the prompt later.
  event.preventDefault();
  store.event = event as InstallPromptEvent;
  changed();
}

function onAppInstalled() {
  store.event = null;
  store.installed = true;
  changed();
}

let capturing = false;

/**
 * Starts listening for the install prompt. It fires early, often before the onboarding page has
 * loaded, so this runs when the module is first imported (the app shell imports it at start-up).
 */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

captureInstallPrompt();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the captured install prompt. A prompt can be shown only once. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = store.event;
  if (!event) return "unavailable";
  store.event = null;
  changed();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}

/** Live install state: whether the browser offered its prompt, and whether it was installed. */
export function useInstallPrompt(): {
  available: boolean;
  installed: boolean;
  promptInstall: () => Promise<InstallOutcome>;
} {
  useSyncExternalStore(
    subscribe,
    () => store.version,
    () => 0,
  );
  return { available: store.event !== null, installed: store.installed, promptInstall };
}

/** Clears the captured prompt between tests. */
export function resetInstallPromptForTests(): void {
  store.event = null;
  store.installed = false;
  changed();
}
