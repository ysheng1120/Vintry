import { currentYear } from "./clock";
import type { Wine } from "./types";

export const WINDOW_STATUSES = ["hold", "ready", "drink-soon", "past-peak", "none"] as const;
export type WindowStatus = (typeof WINDOW_STATUSES)[number];

export const WINDOW_STATUS_LABELS: Record<WindowStatus, string> = {
  hold: "Hold",
  ready: "Ready",
  "drink-soon": "Drink soon",
  "past-peak": "Past peak",
  none: "No window",
};

/**
 * Drinking-window status for year Y (R4): no window gives none; Y before the start gives hold;
 * Y after the end gives past peak; an end within one year gives drink soon; otherwise ready.
 */
export function windowStatus(
  wine: Pick<Wine, "windowFrom" | "windowTo">,
  year: number = currentYear(),
): WindowStatus {
  const { windowFrom, windowTo } = wine;
  if (windowFrom === null && windowTo === null) return "none";
  if (windowFrom !== null && year < windowFrom) return "hold";
  if (windowTo !== null && year > windowTo) return "past-peak";
  if (windowTo !== null && windowTo - year <= 1) return "drink-soon";
  return "ready";
}

/** "2020–2035", with "…" for an open end: the one way a drinking window is written out. */
export function windowRange(from: number | null, to: number | null): string {
  return `${from ?? "…"}–${to ?? "…"}`;
}
