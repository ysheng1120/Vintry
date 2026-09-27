import type { WineDraft } from "../../domain/commands/schemas";
import { isMatchCandidate, wineKey } from "../../domain/match";
import type { Lot, Wine } from "../../domain/types";
import type { ImportRow } from "./rows";

/**
 * The live cellar an import preview checks rows against: wines a draft may match (the same
 * candidates `addDrafts` matches against), every lot of theirs (open or closed), and the
 * locations those lots' ids name.
 */
export interface ExistingCellar {
  wines: Wine[];
  lots: Lot[];
  locations: { id: string; name: string }[];
}

function buildWineIndex(wines: Wine[]): Map<string, Wine> {
  const index = new Map<string, Wine>();
  for (const wine of wines) {
    if (isMatchCandidate(wine) && !index.has(wineKey(wine))) index.set(wineKey(wine), wine);
  }
  return index;
}

function groupLotsByWine(lots: Lot[]): Map<string, Lot[]> {
  const groups = new Map<string, Lot[]>();
  for (const lot of lots) {
    const list = groups.get(lot.wineId) ?? [];
    list.push(lot);
    groups.set(lot.wineId, list);
  }
  return groups;
}

/** `null`/`undefined` compare equal to each other (a blank cell matches a never-set field). */
function sameOrBothEmpty<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** A precomputed cellar, ready to check many rows against without rescanning it each time. */
export interface DuplicateIndex {
  wineIndex: Map<string, Wine>;
  lotsByWine: Map<string, Lot[]>;
  locationNames: Map<string, string>;
}

export function buildDuplicateIndex(cellar: ExistingCellar): DuplicateIndex {
  return {
    wineIndex: buildWineIndex(cellar.wines),
    lotsByWine: groupLotsByWine(cellar.lots),
    locationNames: new Map(cellar.locations.map((l) => [l.id, l.name])),
  };
}

function locationName(id: string | null | undefined, names: Map<string, string>): string | null {
  return id ? (names.get(id) ?? null) : null;
}

/**
 * The existing lot that makes `draft` look already in the cellar, if any: `draft` matches a live
 * wine the same way `addDrafts` would attach it (same producer, cuvée, vintage and bottle size),
 * and that wine already has a lot — open or closed — with the same bottle count, purchase date (or
 * both blank), price per bottle (or both blank), and location name (or both blank).
 */
export function findDuplicateLot(draft: WineDraft, index: DuplicateIndex): Lot | undefined {
  const lot = draft.lots?.[0];
  if (!lot) return undefined;
  const wine = index.wineIndex.get(wineKey(draft));
  if (!wine) return undefined;
  const rowLocation = locationName(lot.locationId, index.locationNames);
  return (index.lotsByWine.get(wine.id) ?? []).find(
    (existing) =>
      existing.quantity === lot.quantity &&
      sameOrBothEmpty(existing.purchaseDate, lot.purchaseDate) &&
      sameOrBothEmpty(existing.pricePerBottle, lot.pricePerBottle) &&
      sameOrBothEmpty(locationName(existing.locationId, index.locationNames), rowLocation),
  );
}

/** True when `draft` looks already in the cellar; see `findDuplicateLot`. */
export function isLikelyDuplicate(draft: WineDraft, cellar: ExistingCellar): boolean {
  return findDuplicateLot(draft, buildDuplicateIndex(cellar)) !== undefined;
}

/** The `rowIndex` of every import row that looks already in the cellar. */
export function findDuplicateRowIndexes(rows: ImportRow[], cellar: ExistingCellar): Set<number> {
  const index = buildDuplicateIndex(cellar);
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (row.draft && findDuplicateLot(row.draft, index)) duplicates.add(row.rowIndex);
  }
  return duplicates;
}

/**
 * Whether a row should be sent to `importRows`: it has a draft, and either it doesn't look like a
 * duplicate or the collector chose to include it anyway.
 */
export function shouldImportRow(
  row: ImportRow,
  duplicateRowIndexes: Set<number>,
  includedOverrides: Set<number>,
): boolean {
  if (!row.draft) return false;
  return !duplicateRowIndexes.has(row.rowIndex) || includedOverrides.has(row.rowIndex);
}
