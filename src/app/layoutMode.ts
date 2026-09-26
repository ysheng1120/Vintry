import { useMediaQuery } from "../components/ui/useMediaQuery";

/** KTD18: sidebar from 1100 px, icon rail from 720 px, bottom bar below that. */
export type LayoutMode = "sidebar" | "rail" | "bottom";

export const SIDEBAR_MIN_WIDTH = 1100;
export const RAIL_MIN_WIDTH = 720;

export function useLayoutMode(): LayoutMode {
  const wide = useMediaQuery(`(min-width: ${SIDEBAR_MIN_WIDTH}px)`, true);
  const medium = useMediaQuery(`(min-width: ${RAIL_MIN_WIDTH}px)`, true);
  if (wide) return "sidebar";
  return medium ? "rail" : "bottom";
}
