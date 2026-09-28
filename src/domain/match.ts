import { db } from "../db/db";
import { DEFAULT_BOTTLE_SIZE, type Wine } from "./types";

/** Lowercases, strips accents and punctuation, and collapses spaces (KTD6). */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface MatchFields {
  producer: string;
  name?: string | null;
  vintage: number | null;
  bottleSize?: number | null;
}

/** Duplicate key: producer + cuvée + vintage (or NV) + bottle size (KTD6). */
export function wineKey(fields: MatchFields): string {
  return [
    normalizeName(fields.producer),
    normalizeName(fields.name ?? ""),
    fields.vintage ?? "nv",
    fields.bottleSize ?? DEFAULT_BOTTLE_SIZE,
  ].join("|");
}

/** Wines a new draft may attach to: not deleted, and not part of the sample cellar. */
export function isMatchCandidate(wine: Wine): boolean {
  return !wine.deletedAt && !wine.isSample;
}

/** What a draft is matched by: its identity, and CellarTracker's wine id when it has one. */
export interface MatchDraft extends MatchFields {
  cellarTrackerId?: string | null;
}

/** Finds the wine a draft attaches to, among the wines it was built from and those added since. */
export interface WineMatcher {
  find(draft: MatchDraft): Wine | undefined;
  /** Adds a wine (new, or one that just gained a CellarTracker id) so later drafts match it. */
  add(wine: Wine): void;
}

/**
 * Matches drafts to match candidates: by CellarTracker's wine id first (so a renamed wine still
 * matches its next export), then by `wineKey`. The first candidate for a key wins.
 */
export function buildWineMatcher(wines: Wine[]): WineMatcher {
  const byKey = new Map<string, Wine>();
  const byCellarTrackerId = new Map<string, Wine>();
  const add = (wine: Wine) => {
    if (!isMatchCandidate(wine)) return;
    const key = wineKey(wine);
    const known = byKey.get(key);
    if (!known || known.id === wine.id) byKey.set(key, wine);
    const ctId = wine.cellarTrackerId;
    if (!ctId) return;
    const knownCt = byCellarTrackerId.get(ctId);
    if (!knownCt || knownCt.id === wine.id) byCellarTrackerId.set(ctId, wine);
  };
  for (const wine of wines) add(wine);
  return {
    find(draft) {
      const byId = draft.cellarTrackerId ? byCellarTrackerId.get(draft.cellarTrackerId) : undefined;
      return byId ?? byKey.get(wineKey(draft));
    },
    add,
  };
}

/**
 * Finds the existing wine a draft describes, for scan, describe and import (R11, AE1).
 * Deleted and sample wines never match, so real bottles never attach to them.
 */
export async function findMatchingWine(draft: MatchFields): Promise<Wine | undefined> {
  const key = wineKey(draft);
  const wines = await db.wines.toArray();
  return wines.find((wine) => isMatchCandidate(wine) && wineKey(wine) === key);
}
