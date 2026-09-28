import type { ImportDraft } from "../../domain/commands/schemas";
import { buildWineMatcher, normalizeName, type WineMatcher } from "../../domain/match";
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
  matcher: WineMatcher;
  lotsByWine: Map<string, Lot[]>;
  locationNames: Map<string, string>;
}

export function buildDuplicateIndex(cellar: ExistingCellar): DuplicateIndex {
  return {
    matcher: buildWineMatcher(cellar.wines),
    lotsByWine: groupLotsByWine(cellar.lots),
    locationNames: new Map(cellar.locations.map((l) => [l.id, l.name])),
  };
}

/** A lot's location name: null for no location, undefined for one Vintry doesn't have yet. */
function locationName(
  id: string | null | undefined,
  names: Map<string, string>,
): string | null | undefined {
  return id ? names.get(id) : null;
}

/**
 * The existing lot that makes `draft` look already in the cellar, if any: `draft` matches a live
 * wine the same way `addDrafts` would attach it (CellarTracker id, else producer, cuvée, vintage
 * and bottle size), and that wine already has a lot — open or closed — with the same bottle
 * count, purchase date (or both blank), price per bottle (or both blank), and location name (or
 * both blank). A row going to a location Vintry doesn't have yet never matches.
 */
export function findDuplicateLot(draft: ImportDraft, index: DuplicateIndex): Lot | undefined {
  const lot = draft.lots?.[0];
  if (!lot) return undefined;
  const wine = index.matcher.find(draft);
  if (!wine) return undefined;
  const rowLocation = locationName(lot.locationId, index.locationNames);
  if (rowLocation === undefined) return undefined;
  return (index.lotsByWine.get(wine.id) ?? []).find(
    (existing) =>
      existing.quantity === lot.quantity &&
      sameOrBothEmpty(existing.purchaseDate, lot.purchaseDate) &&
      sameOrBothEmpty(existing.pricePerBottle, lot.pricePerBottle) &&
      sameOrBothEmpty(locationName(existing.locationId, index.locationNames), rowLocation),
  );
}

/** True when `draft` looks already in the cellar; see `findDuplicateLot`. */
export function isLikelyDuplicate(draft: ImportDraft, cellar: ExistingCellar): boolean {
  return findDuplicateLot(draft, buildDuplicateIndex(cellar)) !== undefined;
}

/**
 * What importing a row does, compared with the cellar:
 * - `new`: add the row as it is;
 * - `already`: the cellar has these bottles; left out;
 * - `fewer`: the cellar has more bottles there than the file (`have` against `file`); left out,
 *   since import never removes bottles or history;
 * - `topUp`: the file has more bottles there; only the `add` new ones are imported, as `have`
 *   are already in the cellar.
 */
export type RowPlan =
  | { kind: "new" }
  | { kind: "already" }
  | { kind: "fewer"; have: number; file: number }
  | { kind: "topUp"; add: number; have: number };

const NEW: RowPlan = { kind: "new" };

/**
 * The place a lot sits for comparing counts: wine, location name and bin (case-, accent- and
 * punctuation-insensitive; blank matches blank), or undefined for a location Vintry doesn't
 * have yet.
 */
function slotKey(
  wineId: string,
  locationId: string | null | undefined,
  bin: string | null | undefined,
  names: Map<string, string>,
): string | undefined {
  const name = locationName(locationId, names);
  if (name === undefined) return undefined;
  const place = name === null ? "" : `@${normalizeName(name)}`;
  return `${wineId}|${place}|${normalizeName(bin ?? "")}`;
}

export interface PlanOptions {
  /**
   * True when the file lists the whole cellar as it is now (a CellarTracker export), so its
   * counts can be compared with Vintry's. Other files (a list of new purchases, a Vivino scan
   * history) keep the exact-duplicate rule only.
   */
  compareCounts?: boolean;
}

/**
 * Plans every row that has a draft, keyed by `rowIndex`. With `compareCounts`, a row that
 * matches a wine (as `addDrafts` would) at a location and bin where that wine has open bottles
 * compares counts: the file's rows for that place, in file order, against the open bottles
 * there. Equal is `already`; fewer in the file is `fewer`; more in the file tops up with the
 * difference. Any other row keeps the exact-duplicate rule (`findDuplicateLot`): `already` or
 * `new`.
 */
export function planImportRows(
  rows: ImportRow[],
  cellar: ExistingCellar,
  options: PlanOptions = {},
): Map<number, RowPlan> {
  const index = buildDuplicateIndex(cellar);
  const openBySlot = new Map<string, number>();
  for (const lot of cellar.lots) {
    if (lot.closedAt || lot.quantity <= 0) continue;
    const key = slotKey(lot.wineId, lot.locationId, lot.bin, index.locationNames);
    if (key !== undefined) openBySlot.set(key, (openBySlot.get(key) ?? 0) + lot.quantity);
  }

  const plans = new Map<number, RowPlan>();
  const rowsBySlot = new Map<string, { rowIndex: number; quantity: number }[]>();
  for (const row of rows) {
    const lot = row.draft?.lots?.[0];
    if (!row.draft) continue;
    const wine = lot ? index.matcher.find(row.draft) : undefined;
    const key = lot && wine && slotKey(wine.id, lot.locationId, lot.bin, index.locationNames);
    if (options.compareCounts && lot && key !== undefined && openBySlot.has(key)) {
      const list = rowsBySlot.get(key) ?? [];
      list.push({ rowIndex: row.rowIndex, quantity: lot.quantity });
      rowsBySlot.set(key, list);
      continue;
    }
    plans.set(row.rowIndex, findDuplicateLot(row.draft, index) ? { kind: "already" } : NEW);
  }

  for (const [key, slotRows] of rowsBySlot) {
    const have = openBySlot.get(key) ?? 0;
    const file = slotRows.reduce((sum, r) => sum + r.quantity, 0);
    if (file < have) {
      for (const r of slotRows) plans.set(r.rowIndex, { kind: "fewer", have, file });
      continue;
    }
    // The cellar's bottles there cover the file's rows in order; what is left over is new.
    let covered = have;
    for (const r of slotRows) {
      const mine = Math.min(r.quantity, covered);
      covered -= mine;
      if (mine === r.quantity) plans.set(r.rowIndex, { kind: "already" });
      else if (mine === 0) plans.set(r.rowIndex, NEW);
      else plans.set(r.rowIndex, { kind: "topUp", add: r.quantity - mine, have: mine });
    }
  }
  return plans;
}

/** True for a plan whose row is left out unless the collector includes it anyway. */
export function isLeftOut(plan: RowPlan | undefined): boolean {
  return plan?.kind === "already" || plan?.kind === "fewer";
}

/** The `rowIndex` of every row that is left out by default (see `planImportRows`). */
export function leftOutRowIndexes(plans: Map<number, RowPlan>): Set<number> {
  return new Set([...plans].filter(([, plan]) => isLeftOut(plan)).map(([rowIndex]) => rowIndex));
}

/**
 * The drafts to send to `importRows`: rows that aren't left out, plus those the collector
 * included anyway. A top-up row adds only its new bottles, unless included anyway, which
 * imports the whole row.
 */
export function draftsToImport(
  rows: ImportRow[],
  plans: Map<number, RowPlan>,
  included: Set<number>,
): { row: ImportRow; draft: ImportDraft }[] {
  const out: { row: ImportRow; draft: ImportDraft }[] = [];
  for (const row of rows) {
    const plan = plans.get(row.rowIndex);
    if (!row.draft || (isLeftOut(plan) && !included.has(row.rowIndex))) continue;
    const lot = row.draft.lots?.[0];
    if (plan?.kind === "topUp" && lot && !included.has(row.rowIndex)) {
      out.push({ row, draft: { ...row.draft, lots: [{ ...lot, quantity: plan.add }] } });
    } else {
      out.push({ row, draft: row.draft });
    }
  }
  return out;
}

/** The preview's short note for a planned row, or null for a plain new row. */
export function rowPlanLabel(plan: RowPlan | undefined): string | null {
  switch (plan?.kind) {
    case "already":
      return "Already in your cellar";
    case "fewer":
      return `Vintry has ${plan.have}, the file has ${plan.file}: record drinks in Vintry`;
    case "topUp":
      return `Adds ${plan.add} (${plan.have} already in your cellar)`;
    default:
      return null;
  }
}
