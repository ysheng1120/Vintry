import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { COLOUR_LABELS, type Colour, type Consumption, type TastingNote, type Wine } from "./types";

/**
 * "What you like": a taste profile computed from the collector's own ratings, with no AI call
 * (KTD-taste). A rated wine counts once, at the best rating recorded for it across its own
 * `rating`, its tasting notes' ratings and its drinks' ratings (all `RatingSchema`, 0-100, 20
 * points a star — see `RATED_WELL_THRESHOLD` in lastBottles.ts for the same scale). Only live,
 * non-sample wines count, matching the rest of the stats screen.
 *
 * A colour, country, region or grape only becomes a "favourite" once at least
 * `MIN_RATED_FOR_FAVOURITE` rated wines share it: one wine says nothing about a taste. Favourites
 * are sorted by average rating, then by how many wines back it up, then by name, and capped at
 * `FAVOURITES_LIMIT`. The whole profile is only shown once there is "enough data"
 * (`MIN_RATED_FOR_PROFILE` rated wines), so a new collector is not shown a "favourite" built from
 * one or two bottles.
 */

/** A group needs at least this many rated wines to count as a favourite. */
export const MIN_RATED_FOR_FAVOURITE = 2;

/** Rated wines needed before the profile counts as having "enough data" to show. */
export const MIN_RATED_FOR_PROFILE = 5;

/** At most this many favourites shown per group. */
export const FAVOURITES_LIMIT = 5;

export interface Favourite {
  key: string;
  label: string;
  /** Rated wines behind this favourite. */
  count: number;
  /** Average rating (0-100) across those wines. */
  averageRating: number;
}

export interface TasteProfile {
  /** How many wines have a rating at all. */
  ratedWines: number;
  /** Average rating (0-100) across every rated wine; null when none are rated. */
  averageRating: number | null;
  /** At least `MIN_RATED_FOR_PROFILE` rated wines. */
  enoughData: boolean;
  colours: Favourite[];
  countries: Favourite[];
  regions: Favourite[];
  grapes: Favourite[];
  /** By vintage decade, e.g. "2010s"; non-vintage wines group under "NV". Optional extra cut. */
  vintageDecades: Favourite[];
}

interface RatedWine {
  wine: Wine;
  rating: number;
}

/** The best rating recorded for a wine: its own, its tasting notes', or its drinks'. */
function bestRating(wine: Wine, notes: TastingNote[], consumptions: Consumption[]): number | null {
  const ratings = [
    wine.rating,
    ...notes.map((n) => n.rating),
    ...consumptions.map((c) => c.rating),
  ].filter((r): r is number => r !== null);
  return ratings.length ? Math.max(...ratings) : null;
}

/** Live, non-sample wines with a rating, each counted once at its best rating. */
function ratedWines(wines: Wine[], notes: TastingNote[], consumptions: Consumption[]): RatedWine[] {
  const notesByWine = new Map<string, TastingNote[]>();
  for (const note of notes) {
    const list = notesByWine.get(note.wineId) ?? [];
    list.push(note);
    notesByWine.set(note.wineId, list);
  }
  const consumptionsByWine = new Map<string, Consumption[]>();
  for (const c of consumptions) {
    const list = consumptionsByWine.get(c.wineId) ?? [];
    list.push(c);
    consumptionsByWine.set(c.wineId, list);
  }

  return wines
    .filter((wine) => !wine.deletedAt && !wine.isSample)
    .flatMap((wine) => {
      const rating = bestRating(
        wine,
        notesByWine.get(wine.id) ?? [],
        consumptionsByWine.get(wine.id) ?? [],
      );
      return rating !== null ? [{ wine, rating }] : [];
    });
}

/**
 * Groups rated wines by one or more keys each wine contributes (a wine with several grapes
 * counts once towards each), keeping only groups with enough wines, and returns the top
 * favourites by average rating, then by count, then by name.
 */
function favouritesBy(
  rated: RatedWine[],
  keysOf: (wine: Wine) => string[],
  labelOf: (key: string) => string = (key) => key,
): Favourite[] {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const { wine, rating } of rated) {
    for (const key of keysOf(wine)) {
      const entry = totals.get(key) ?? { sum: 0, count: 0 };
      entry.sum += rating;
      entry.count += 1;
      totals.set(key, entry);
    }
  }
  return [...totals]
    .filter(([, { count }]) => count >= MIN_RATED_FOR_FAVOURITE)
    .map(([key, { sum, count }]) => ({
      key,
      label: labelOf(key),
      count,
      averageRating: Math.round((sum / count) * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.averageRating - a.averageRating || b.count - a.count || a.label.localeCompare(b.label),
    )
    .slice(0, FAVOURITES_LIMIT);
}

const decadeKey = (vintage: number | null): string =>
  vintage === null ? "nv" : `${Math.floor(vintage / 10) * 10}s`;
const decadeLabel = (key: string): string => (key === "nv" ? "NV" : key);

/** Pure taste profile from already-loaded rows; the hook below wires it up to the live database. */
export function computeTasteProfile(
  wines: Wine[],
  notes: TastingNote[],
  consumptions: Consumption[],
): TasteProfile {
  const rated = ratedWines(wines, notes, consumptions);
  const ratedCount = rated.length;
  const averageRating = ratedCount
    ? Math.round((rated.reduce((sum, r) => sum + r.rating, 0) / ratedCount) * 10) / 10
    : null;

  return {
    ratedWines: ratedCount,
    averageRating,
    enoughData: ratedCount >= MIN_RATED_FOR_PROFILE,
    colours: favouritesBy(
      rated,
      (w) => [w.colour],
      (key) => COLOUR_LABELS[key as Colour],
    ),
    countries: favouritesBy(rated, (w) => (w.country ? [w.country] : [])),
    regions: favouritesBy(rated, (w) => (w.region ? [w.region] : [])),
    grapes: favouritesBy(rated, (w) => w.grapes),
    vintageDecades: favouritesBy(rated, (w) => [decadeKey(w.vintage)], decadeLabel),
  };
}

/** Loads the taste profile from the database (used by the Stats page and the sommelier tool). */
export async function getTasteProfile(): Promise<TasteProfile> {
  const [wines, notes, consumptions] = await Promise.all([
    db.wines.toArray(),
    db.tastingNotes.toArray(),
    db.consumptions.toArray(),
  ]);
  return computeTasteProfile(wines, notes, consumptions);
}

/** Live taste profile ("What you like"); undefined while loading. */
export function useTasteProfile(): TasteProfile | undefined {
  return useLiveQuery(() => getTasteProfile(), []);
}
