import { useCallback, useSyncExternalStore } from "react";

function canMatch(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * Live result of a CSS media query. `fallback` is used where matchMedia is missing
 * (for example jsdom in tests), so layouts default to the desktop view.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatch()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => (canMatch() ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}
