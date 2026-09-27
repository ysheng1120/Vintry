import { wineLabel } from "../../domain/labels";
import type { Lot, Wine } from "../../domain/types";

/**
 * Pure grouping logic for the bins view (R7): given a location's live open lots, arrange them by
 * bin so the collector can see what's where. Kept free of Dexie so it's cheap to unit test.
 */

/** One lot's bottles, ready to render inside a bin. */
export interface BinBottleRow {
  lotId: string;
  wineId: string;
  /** From `wineLabel`, already includes the vintage (or "NV"). */
  label: string;
  vintage: number | null;
  quantity: number;
}

/** A bin and what it holds. `bin` is `null` for lots with no bin ("No bin", sorted last). */
export interface BinGroup {
  bin: string | null;
  bottles: number;
  rows: BinBottleRow[];
}

/** Splits "A10" into `["a", 10]` so bins compare piece by piece instead of character by character. */
function naturalParts(value: string): (string | number)[] {
  const parts = value.match(/\d+|\D+/g) ?? [value];
  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

/** Natural sort: "A2" before "A10", "A" before "A2". */
export function compareBinNames(a: string, b: string): number {
  const left = naturalParts(a);
  const right = naturalParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/** Bins sorted naturally; lots with no bin form a final "No bin" group. */
export function binLabel(bin: string | null): string {
  return bin ?? "No bin";
}

/**
 * Groups a location's live open lots by bin. Callers pass only live wines (not soft-deleted) and
 * open lots (`quantity > 0`) already at this location, the same filtering `getLocationsWithCounts`
 * uses for its counts.
 */
export function groupLotsByBin(lots: Lot[], wines: Map<string, Wine>): BinGroup[] {
  const rowsByBin = new Map<string | null, BinBottleRow[]>();
  for (const lot of lots) {
    const wine = wines.get(lot.wineId);
    if (!wine) continue;
    const key = lot.bin?.trim() || null;
    const row: BinBottleRow = {
      lotId: lot.id,
      wineId: wine.id,
      label: wineLabel(wine),
      vintage: wine.vintage,
      quantity: lot.quantity,
    };
    rowsByBin.set(key, [...(rowsByBin.get(key) ?? []), row]);
  }

  return [...rowsByBin.entries()]
    .sort(([a], [b]) => {
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      return compareBinNames(a, b);
    })
    .map(([bin, rows]) => ({
      bin,
      bottles: rows.reduce((sum, row) => sum + row.quantity, 0),
      rows: rows.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/** Keeps only bottles whose label matches `query` (case-insensitive), dropping empty bins. */
export function filterBinGroups(groups: BinGroup[], query: string): BinGroup[] {
  const words = query.trim().toLowerCase();
  if (!words) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((r) => r.label.toLowerCase().includes(words)),
    }))
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ ...group, bottles: group.rows.reduce((sum, r) => sum + r.quantity, 0) }));
}

/** Total lots across all bins, used to decide whether to show the search box. */
export function countLots(groups: BinGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}
