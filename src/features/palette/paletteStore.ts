import { useSyncExternalStore } from "react";

/** Which palette dialog is open: the command palette, the shortcuts help, or neither. */
export type PaletteDialog = "palette" | "shortcuts" | null;

let open: PaletteDialog = null;
const listeners = new Set<() => void>();

function set(next: PaletteDialog) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export const openPalette = () => set("palette");
export const openShortcuts = () => set("shortcuts");
export const closePaletteDialogs = () => set(null);
export const getOpenPaletteDialog = (): PaletteDialog => open;

export function useOpenPaletteDialog(): PaletteDialog {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => null,
  );
}
