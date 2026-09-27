import { currentYear } from "./clock";
import type { EventSource, Wine, WindowSource } from "./types";

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
 * Y after the end gives past peak; a window that ends in Y gives drink soon; otherwise ready.
 * Windows are whole years, so "drink soon" means "drink this year".
 */
export function windowStatus(
  wine: Pick<Wine, "windowFrom" | "windowTo">,
  year: number = currentYear(),
): WindowStatus {
  const { windowFrom, windowTo } = wine;
  if (windowFrom === null && windowTo === null) return "none";
  if (windowFrom !== null && year < windowFrom) return "hold";
  if (windowTo !== null && year > windowTo) return "past-peak";
  if (windowTo !== null && windowTo === year) return "drink-soon";
  return "ready";
}

/**
 * The window source a change may record. Only the collector can mark a window as their own:
 * - a sommelier change ("ai-chat") is always "ai", even after the collector confirms its card,
 *   because the model wrote its input;
 * - a scan or describe draft keeps what the draft form recorded ("user" only when the collector
 *   changed the window there), else "ai";
 * - an import is "import" (or "ai" when the import says so);
 * - otherwise the requested source, else "user".
 */
export function allowedWindowSource(
  eventSource: EventSource,
  requested?: WindowSource | null,
): WindowSource {
  if (eventSource === "ai-chat") return "ai";
  if (eventSource.startsWith("ai-")) return requested ?? "ai";
  if (eventSource === "import") return requested === "ai" ? "ai" : "import";
  return requested ?? "user";
}

/** "2020–2035", with "…" for an open end: the one way a drinking window is written out. */
export function windowRange(from: number | null, to: number | null): string {
  return `${from ?? "…"}–${to ?? "…"}`;
}
