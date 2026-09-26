export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** localStorage copy of the preference, read before first paint to avoid a theme flash. */
const CACHE_KEY = "vintry.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Puts exactly one of `light` / `dark` on <html>; the CSS tokens key off that class. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function readCachedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(CACHE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function cachePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(CACHE_KEY, preference);
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this session.
  }
}
