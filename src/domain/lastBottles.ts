import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { normalizeName } from "./match";
import type { Lot, TastingNote, Wine } from "./types";

/**
 * "Last bottles" on Home: wines the collector has rated well that are down to their last bottle.
 * Ratings use the 100-point scale (see `RatingSchema`), 20 points a star; 80+ (four stars or more) is "rated well".
 */
export const RATED_WELL_THRESHOLD = 80;

/** How many rows the Home section shows at most. */
export const LAST_BOTTLES_LIMIT = 6;

export interface LastBottleRow {
  wine: Wine;
  /** The best of the wine's own rating and its tasting notes' ratings (what earned it a place here). */
  rating: number;
}

const byName = (a: Wine, b: Wine) =>
  normalizeName(a.producer).localeCompare(normalizeName(b.producer)) ||
  normalizeName(a.name).localeCompare(normalizeName(b.name)) ||
  (a.vintage ?? 9999) - (b.vintage ?? 9999);

/** The best rating a wine has: its own, or its highest-rated tasting note. */
function bestRating(wine: Wine, notes: TastingNote[]): number | null {
  const ratings = [wine.rating, ...notes.map((n) => n.rating)].filter(
    (r): r is number => r !== null,
  );
  return ratings.length ? Math.max(...ratings) : null;
}

/**
 * Wines rated well (>= `RATED_WELL_THRESHOLD`) with exactly one bottle left across their open
 * lots, excluding sample and deleted wines. Best-rated first, then by name, capped at `limit`.
 */
export function selectLastBottles(
  wines: Wine[],
  lots: Lot[],
  notes: TastingNote[],
  limit = LAST_BOTTLES_LIMIT,
): LastBottleRow[] {
  const bottlesByWine = new Map<string, number>();
  for (const lot of lots) {
    if (lot.quantity <= 0) continue;
    bottlesByWine.set(lot.wineId, (bottlesByWine.get(lot.wineId) ?? 0) + lot.quantity);
  }
  const notesByWine = new Map<string, TastingNote[]>();
  for (const note of notes) {
    const list = notesByWine.get(note.wineId) ?? [];
    list.push(note);
    notesByWine.set(note.wineId, list);
  }

  return wines
    .filter((wine) => !wine.deletedAt && !wine.isSample)
    .filter((wine) => (bottlesByWine.get(wine.id) ?? 0) === 1)
    .flatMap((wine) => {
      const rating = bestRating(wine, notesByWine.get(wine.id) ?? []);
      return rating !== null && rating >= RATED_WELL_THRESHOLD ? [{ wine, rating }] : [];
    })
    .sort((a, b) => b.rating - a.rating || byName(a.wine, b.wine))
    .slice(0, limit);
}

async function loadLastBottles(): Promise<LastBottleRow[]> {
  const [wines, lots, notes] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.tastingNotes.toArray(),
  ]);
  return selectLastBottles(wines, lots, notes);
}

/** Live "last bottles" list for Home; undefined while loading. */
export function useLastBottles(): LastBottleRow[] | undefined {
  return useLiveQuery(() => loadLastBottles(), []);
}
