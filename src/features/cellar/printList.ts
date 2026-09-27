import { now } from "../../domain/clock";
import type { CellarRow } from "../../domain/selectors";
import { formatDate, pluralize, toIsoDate } from "../../lib/format";
import { windowRange } from "../../domain/window";

/** "2020–2035", or "No window" when the wine has neither end set. */
export function windowRangeLabel(wine: {
  windowFrom: number | null;
  windowTo: number | null;
}): string {
  const { windowFrom, windowTo } = wine;
  if (windowFrom === null && windowTo === null) return "No window";
  return windowRange(windowFrom, windowTo);
}

/** "Vintry cellar list — 27 Sept 2026 — 4 wines, 26 bottles". */
export function printListTitle(rows: CellarRow[], date: Date = now()): string {
  const bottleCount = rows.reduce((sum, r) => sum + r.bottles, 0);
  return `Vintry cellar list — ${formatDate(toIsoDate(date))} — ${pluralize(rows.length, "wine")}, ${pluralize(bottleCount, "bottle")}`;
}
