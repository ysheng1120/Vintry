import { useSyncExternalStore } from "react";

/** Whether the coach-mark tour is running. Help's "Take the tour again" starts it directly. */
let active = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

export function startTour(): void {
  set(true);
}

export function stopTour(): void {
  set(false);
}

export function useTourActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active,
    () => false,
  );
}
