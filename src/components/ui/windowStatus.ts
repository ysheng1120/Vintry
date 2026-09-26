export type WindowStatus = "hold" | "ready" | "drink-soon" | "past-peak" | "no-window";

/**
 * Presentational copy of the R4 rule (plan, High-Level Technical Design), used only to colour
 * the bar. Screens should show the domain's status badge; this keeps the bar self-contained.
 */
export function windowStatusFor(
  from: number | null | undefined,
  to: number | null | undefined,
  year: number,
): WindowStatus {
  if (from == null && to == null) return "no-window";
  if (from != null && year < from) return "hold";
  if (to != null && year > to) return "past-peak";
  if (to != null && to - year <= 1) return "drink-soon";
  return "ready";
}
