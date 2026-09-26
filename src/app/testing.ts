/**
 * Test doubles for modules the shell depends on but that tests should not touch for real:
 * the settings store and database events (src/db, U2) and the PWA register hook.
 * Use with vi.mock, e.g.
 *   vi.mock("../db/settings", async () => (await import("./testing")).settingsModule);
 */
import { useSyncExternalStore } from "react";

// ---- settings: an in-memory key/value store with live updates ----
const settings = new Map<string, unknown>();
const settingsListeners = new Set<() => void>();

function notifySettings() {
  for (const listener of settingsListeners) listener();
}

export const settingsModule = {
  useSetting<T>(key: string, fallback: T): T {
    const value = useSyncExternalStore(
      (onChange) => {
        settingsListeners.add(onChange);
        return () => settingsListeners.delete(onChange);
      },
      () => settings.get(key),
    );
    return value === undefined ? fallback : (value as T);
  },
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    return settings.has(key) ? (settings.get(key) as T) : fallback;
  },
  async setSetting(key: string, value: unknown): Promise<void> {
    settings.set(key, value);
    notifySettings();
  },
  async deleteSetting(key: string): Promise<void> {
    settings.delete(key);
    notifySettings();
  },
};

export function resetTestSettings(initial: Record<string, unknown> = {}) {
  settings.clear();
  for (const [key, value] of Object.entries(initial)) settings.set(key, value);
  notifySettings();
}

export function readTestSetting(key: string): unknown {
  return settings.get(key);
}

// ---- db: the versionchange signal ----
const versionListeners = new Set<() => void>();

export const dbModule = {
  onVersionChange(listener: () => void): () => void {
    versionListeners.add(listener);
    return () => versionListeners.delete(listener);
  },
};

export function emitVersionChange() {
  for (const listener of versionListeners) listener();
}

// ---- src/app/pwaRegister (wraps virtual:pwa-register/react) ----
type Setter = (value: boolean) => void;
const pwaState = { needRefresh: false, offlineReady: false };
const pwaListeners = new Set<() => void>();
export const pwaCalls = { updateServiceWorker: 0 };

export const pwaModule = {
  useRegisterSW() {
    const snapshot = useSyncExternalStore(
      (onChange) => {
        pwaListeners.add(onChange);
        return () => pwaListeners.delete(onChange);
      },
      () => (pwaState.needRefresh ? 1 : 0) + (pwaState.offlineReady ? 2 : 0),
    );
    const setNeedRefresh: Setter = (value) => setPwa({ needRefresh: value });
    const setOfflineReady: Setter = (value) => setPwa({ offlineReady: value });
    return {
      needRefresh: [Boolean(snapshot & 1), setNeedRefresh] as const,
      offlineReady: [Boolean(snapshot & 2), setOfflineReady] as const,
      updateServiceWorker: async () => {
        pwaCalls.updateServiceWorker += 1;
      },
    };
  },
};

export function setPwa(next: Partial<typeof pwaState>) {
  Object.assign(pwaState, next);
  for (const listener of pwaListeners) listener();
}

export function resetTestPwa() {
  pwaCalls.updateServiceWorker = 0;
  setPwa({ needRefresh: false, offlineReady: false });
}

// ---- window.matchMedia with controllable width and colour scheme ----
export function installMatchMedia({ width = 1280, dark = false } = {}) {
  const lists: { query: string; listeners: Set<(e: MediaQueryListEvent) => void> }[] = [];
  const env = { width, dark };
  const evaluate = (query: string): boolean => {
    if (query.includes("prefers-color-scheme: dark")) return env.dark;
    const min = /min-width:\s*(\d+)px/.exec(query);
    if (min?.[1]) return env.width >= Number(min[1]);
    const max = /max-width:\s*(\d+)px/.exec(query);
    if (max?.[1]) return env.width <= Number(max[1]);
    return false;
  };
  window.matchMedia = (query: string) => {
    const entry = { query, listeners: new Set<(e: MediaQueryListEvent) => void>() };
    lists.push(entry);
    return {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
        entry.listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
        entry.listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
  return {
    set(next: { width?: number; dark?: boolean }) {
      Object.assign(env, next);
      for (const entry of lists) {
        for (const fn of entry.listeners) {
          fn({ matches: evaluate(entry.query), media: entry.query } as MediaQueryListEvent);
        }
      }
    },
  };
}
