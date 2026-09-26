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

/**
 * Finds the existing wine a draft describes, for scan, describe and import (R11, AE1).
 * Deleted and sample wines never match, so real bottles never attach to them.
 */
export async function findMatchingWine(draft: MatchFields): Promise<Wine | undefined> {
  const key = wineKey(draft);
  const wines = await db.wines.toArray();
  return wines.find((wine) => isMatchCandidate(wine) && wineKey(wine) === key);
}
