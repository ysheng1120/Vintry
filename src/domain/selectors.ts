import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { currentYear, nowIso } from "./clock";
import { PURGE_AFTER_DAYS } from "./commands/wines";
import { normalizeName } from "./match";
import { sumByCurrency, wineValue, type CurrencyTotal } from "./money";
import {
  COLOUR_LABELS,
  COLOURS,
  type Colour,
  type Consumption,
  type EventBatch,
  type Location,
  type Lot,
  type TastingNote,
  type Wine,
  type WishlistItem,
} from "./types";
import { WINDOW_STATUSES, WINDOW_STATUS_LABELS, windowStatus, type WindowStatus } from "./window";

/**
 * Read models for the screens. Plain async functions (usable in tests and the AI tools) plus
 * live React hooks that re-render when the data changes.
 */

// ---------- shared loading ----------

interface CellarData {
  wines: Wine[];
  lots: Lot[];
  locations: Map<string, Location>;
  /** Bottles drunk per wine id. */
  drunkByWine: Map<string, number>;
}

async function loadCellar(): Promise<CellarData> {
  const [wines, lots, locations, consumptions] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.locations.toArray(),
    db.consumptions.toArray(),
  ]);
  const drunkByWine = new Map<string, number>();
  for (const c of consumptions)
    drunkByWine.set(c.wineId, (drunkByWine.get(c.wineId) ?? 0) + c.quantity);
  return {
    wines: wines.filter((w) => !w.deletedAt),
    lots,
    locations: new Map(locations.map((l) => [l.id, l])),
    drunkByWine,
  };
}

// ---------- cellar list ----------

export type CellarSort = "name" | "vintage" | "window" | "recent" | "bottles" | "cost" | "value";

export interface CellarQuery {
  /** Words to find in producer, name, region, country, appellation, grapes and vintage. */
  search?: string;
  colours?: Colour[];
  statuses?: WindowStatus[];
  locationIds?: string[];
  countries?: string[];
  regions?: string[];
  /** Also show wines with no bottles left. */
  includeDrunk?: boolean;
  /**
   * Show only wines with at least one bottle drunk, or none left (the Drunk filter, R3). A wine
   * with bottles still in the cellar shows here too once one of them is drunk.
   */
  drunkOnly?: boolean;
  sort?: CellarSort;
}

export interface CellarRow {
  wine: Wine;
  status: WindowStatus;
  /** Bottles in open lots. */
  bottles: number;
  openLots: number;
  locationIds: string[];
  locationNames: string[];
  /** When bottles of this wine were last added. */
  lastAddedAt: string;
  /** Bottles of this wine recorded as drunk. */
  drunkBottles: number;
  /**
   * What the bottles cost per bottle: the average price of the open lots (of all lots once none
   * is open), in the currency most of them use. Null when no lot has a price.
   */
  costPerBottle: { amount: number; currency: string } | null;
}

/** Average price per bottle in the currency most bottles were bought in (never converted). */
function costPerBottle(lots: Lot[]): CellarRow["costPerBottle"] {
  const open = lots.filter((l) => l.quantity > 0);
  const priced = (open.length > 0 ? open : lots).filter(
    (l) => l.pricePerBottle !== null && l.currency !== null,
  );
  // A drunk lot has quantity 0; it still counts once.
  const byCurrency = new Map<string, { bottles: number; total: number }>();
  for (const lot of priced) {
    const weight = Math.max(lot.quantity, 1);
    const entry = byCurrency.get(lot.currency!) ?? { bottles: 0, total: 0 };
    entry.bottles += weight;
    entry.total += lot.pricePerBottle! * weight;
    byCurrency.set(lot.currency!, entry);
  }
  let best: { currency: string; bottles: number; total: number } | null = null;
  for (const [currency, entry] of byCurrency) {
    if (
      !best ||
      entry.bottles > best.bottles ||
      (entry.bottles === best.bottles && currency < best.currency)
    ) {
      best = { currency, ...entry };
    }
  }
  return best
    ? { amount: Math.round((best.total / best.bottles) * 100) / 100, currency: best.currency }
    : null;
}

function buildRows(data: CellarData, year: number): CellarRow[] {
  const lotsByWine = new Map<string, Lot[]>();
  for (const lot of data.lots) {
    const list = lotsByWine.get(lot.wineId) ?? [];
    list.push(lot);
    lotsByWine.set(lot.wineId, list);
  }
  return data.wines.map((wine) => {
    const lots = lotsByWine.get(wine.id) ?? [];
    const open = lots.filter((l) => l.quantity > 0);
    const locationIds = [...new Set(open.map((l) => l.locationId).filter((id) => id !== null))];
    return {
      wine,
      status: windowStatus(wine, year),
      bottles: open.reduce((sum, l) => sum + l.quantity, 0),
      openLots: open.length,
      locationIds,
      locationNames: locationIds.map((id) => data.locations.get(id)?.name ?? "Unknown location"),
      lastAddedAt: lots.reduce((max, l) => (l.createdAt > max ? l.createdAt : max), wine.createdAt),
      drunkBottles: data.drunkByWine.get(wine.id) ?? 0,
      costPerBottle: costPerBottle(lots),
    };
  });
}

function searchText(wine: Wine): string {
  return normalizeName(
    [
      wine.producer,
      wine.name,
      wine.region,
      wine.country,
      wine.appellation,
      ...wine.grapes,
      wine.vintage === null ? "NV" : String(wine.vintage),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const byName = (a: Wine, b: Wine) =>
  normalizeName(a.producer).localeCompare(normalizeName(b.producer)) ||
  normalizeName(a.name).localeCompare(normalizeName(b.name)) ||
  (a.vintage ?? 9999) - (b.vintage ?? 9999);

type Money = { amount: number; currency: string } | null;

/**
 * Highest amount first, without converting currencies: amounts in the currency most of the
 * listed wines use come first, then each other currency in turn. Wines with no amount go last.
 */
function byMoney(pick: (row: CellarRow) => Money, rows: CellarRow[]) {
  const uses = new Map<string, number>();
  for (const row of rows) {
    const money = pick(row);
    if (money) uses.set(money.currency, (uses.get(money.currency) ?? 0) + 1);
  }
  const rank = (currency: string) => uses.get(currency) ?? 0;
  return (a: CellarRow, b: CellarRow) => {
    const x = pick(a);
    const y = pick(b);
    if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1) || byName(a.wine, b.wine);
    return (
      rank(y.currency) - rank(x.currency) ||
      x.currency.localeCompare(y.currency) ||
      y.amount - x.amount ||
      byName(a.wine, b.wine)
    );
  };
}

const rowValue = (row: CellarRow): Money => wineValue(row.wine);

const SORTS: Record<
  Exclude<CellarSort, "cost" | "value">,
  (a: CellarRow, b: CellarRow) => number
> = {
  name: (a, b) => byName(a.wine, b.wine),
  // Oldest vintage first; non-vintage last.
  vintage: (a, b) =>
    (a.wine.vintage ?? Infinity) - (b.wine.vintage ?? Infinity) || byName(a.wine, b.wine),
  // Soonest window end first; wines without a window last.
  window: (a, b) =>
    (a.wine.windowTo ?? Infinity) - (b.wine.windowTo ?? Infinity) ||
    (a.wine.windowFrom ?? Infinity) - (b.wine.windowFrom ?? Infinity) ||
    byName(a.wine, b.wine),
  recent: (a, b) => b.lastAddedAt.localeCompare(a.lastAddedAt) || byName(a.wine, b.wine),
  // Most bottles first; in the Drunk view, most bottles drunk first.
  bottles: (a, b) =>
    b.bottles - a.bottles || b.drunkBottles - a.drunkBottles || byName(a.wine, b.wine),
};

function sorter(sort: CellarSort, rows: CellarRow[]) {
  if (sort === "cost") return byMoney((row) => row.costPerBottle, rows);
  if (sort === "value") return byMoney(rowValue, rows);
  return SORTS[sort];
}

export function filterCellarRows(rows: CellarRow[], query: CellarQuery): CellarRow[] {
  const words = normalizeName(query.search ?? "")
    .split(" ")
    .filter(Boolean);
  const has = <T>(list: T[] | undefined, value: T) => !list?.length || list.includes(value);

  const matched = rows
    .filter((row) => {
      if (query.drunkOnly) return row.bottles === 0 || row.drunkBottles > 0;
      return query.includeDrunk || row.bottles > 0;
    })
    .filter((row) => has(query.colours, row.wine.colour))
    .filter((row) => has(query.statuses, row.status))
    .filter((row) => has(query.countries, row.wine.country ?? ""))
    .filter((row) => has(query.regions, row.wine.region ?? ""))
    .filter(
      (row) =>
        !query.locationIds?.length || row.locationIds.some((id) => query.locationIds?.includes(id)),
    )
    .filter((row) => {
      if (!words.length) return true;
      const text = searchText(row.wine);
      return words.every((word) => text.includes(word));
    });
  return matched.sort(sorter(query.sort ?? "name", matched));
}

export async function getCellarList(
  query: CellarQuery = {},
  year: number = currentYear(),
): Promise<CellarRow[]> {
  return filterCellarRows(buildRows(await loadCellar(), year), query);
}

/** Countries and regions in use, for filter menus. */
export async function getFilterOptions(): Promise<{ countries: string[]; regions: string[] }> {
  const wines = (await db.wines.toArray()).filter((w) => !w.deletedAt);
  const unique = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  return {
    countries: unique(wines.map((w) => w.country)),
    regions: unique(wines.map((w) => w.region)),
  };
}

// ---------- wine detail ----------

export interface LotWithLocation extends Lot {
  locationName: string | null;
}

export interface WineDetail {
  wine: Wine;
  status: WindowStatus;
  bottles: number;
  /** Open lots, largest first. */
  lots: LotWithLocation[];
  /** Lots at zero, kept for history. */
  closedLots: LotWithLocation[];
  /** Newest first. */
  consumptions: Consumption[];
  /** Newest first. */
  notes: TastingNote[];
  /** Event batches that touched this wine or its lots, newest first, at most WINE_HISTORY_LIMIT. */
  history: EventBatch[];
}

/** How many recent event batches a wine's detail carries (the wine page shows the first few). */
export const WINE_HISTORY_LIMIT = 50;

export async function getWineDetail(
  wineId: string,
  year: number = currentYear(),
): Promise<WineDetail | undefined> {
  const wine = await db.wines.get(wineId);
  if (!wine || wine.deletedAt) return undefined;
  const lots = await db.lots.where("wineId").equals(wineId).toArray();
  const related = new Set([wineId, ...lots.map((l) => l.id)]);
  const [consumptions, notes, locations, history] = await Promise.all([
    db.consumptions.where("wineId").equals(wineId).toArray(),
    db.tastingNotes.where("wineId").equals(wineId).toArray(),
    db.locations.toArray(),
    db.eventBatches
      .orderBy("createdAt")
      .reverse()
      .filter((batch) =>
        batch.changes.some((c) => related.has(c.id) || (c.after ?? c.before)?.wineId === wineId),
      )
      .limit(WINE_HISTORY_LIMIT)
      .toArray(),
  ]);
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const withLocation = (lot: Lot): LotWithLocation => ({
    ...lot,
    locationName: lot.locationId ? (names.get(lot.locationId) ?? "Unknown location") : null,
  });
  const newestFirst = <T extends { date: string; createdAt: string }>(a: T, b: T) =>
    b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
  const open = lots.filter((l) => l.quantity > 0).sort((a, b) => b.quantity - a.quantity);

  return {
    wine,
    status: windowStatus(wine, year),
    bottles: open.reduce((sum, l) => sum + l.quantity, 0),
    lots: open.map(withLocation),
    closedLots: lots.filter((l) => l.quantity === 0).map(withLocation),
    consumptions: consumptions.sort(newestFirst),
    notes: notes.sort(newestFirst),
    history,
  };
}

// ---------- home ----------

export interface CellarCounts {
  /** Wines with at least one bottle. */
  wines: number;
  bottles: number;
  openLots: number;
  byStatus: Record<WindowStatus, number>;
}

export interface HomeSections {
  ready: CellarRow[];
  drinkSoon: CellarRow[];
  pastPeak: CellarRow[];
  /** Wines whose window opens this year or next. */
  comingIntoWindow: CellarRow[];
  /** Most recently added first (up to 8). */
  recentlyAdded: CellarRow[];
  counts: CellarCounts;
  /** Cost of bottles in the cellar, one total per currency (never converted). */
  costByCurrency: CurrencyTotal[];
  /**
   * The collector's own values for the bottles in the cellar, one total per currency (never
   * converted). Only wines with a value count.
   */
  valueByCurrency: CurrencyTotal[];
  /** Wines in the cellar that have a value (out of `counts.wines`). */
  valuedWines: number;
  sampleLoaded: boolean;
  /** No wines at all, not even drunk ones. */
  isEmpty: boolean;
}

export async function getHomeSections(year: number = currentYear()): Promise<HomeSections> {
  const data = await loadCellar();
  const rows = buildRows(data, year);
  const inCellar = rows.filter((r) => r.bottles > 0);
  const withStatus = (status: WindowStatus) =>
    inCellar.filter((r) => r.status === status).sort(SORTS.window);

  const byStatus = Object.fromEntries(WINDOW_STATUSES.map((s) => [s, 0])) as Record<
    WindowStatus,
    number
  >;
  for (const row of inCellar) byStatus[row.status] += 1;

  // A Set lookup keeps this a single pass over the lots table instead of scanning every
  // in-cellar wine for each lot (O(lots) rather than O(lots * wines)).
  const cellarWineIds = new Set(inCellar.map((r) => r.wine.id));
  const openLots = data.lots.filter((l) => l.quantity > 0 && cellarWineIds.has(l.wineId));
  const valued = inCellar.flatMap((row) => {
    const value = wineValue(row.wine);
    return value ? [{ row, value }] : [];
  });
  return {
    ready: withStatus("ready"),
    drinkSoon: withStatus("drink-soon"),
    pastPeak: withStatus("past-peak"),
    // Wines still on hold that open next year. A window opening this year already shows as Ready.
    comingIntoWindow: inCellar
      .filter((r) => r.status === "hold" && r.wine.windowFrom === year + 1)
      .sort(
        (a, b) => (a.wine.windowFrom ?? 0) - (b.wine.windowFrom ?? 0) || byName(a.wine, b.wine),
      ),
    recentlyAdded: [...inCellar].sort(SORTS.recent).slice(0, 8),
    counts: {
      wines: inCellar.length,
      bottles: inCellar.reduce((sum, r) => sum + r.bottles, 0),
      openLots: openLots.length,
      byStatus,
    },
    costByCurrency: sumByCurrency(
      openLots.map((l) => ({
        amount: l.pricePerBottle === null ? null : l.pricePerBottle * l.quantity,
        currency: l.currency,
      })),
    ),
    valueByCurrency: sumByCurrency(
      valued.map(({ row, value }) => ({
        amount: value.amount * row.bottles,
        currency: value.currency,
      })),
    ),
    valuedWines: valued.length,
    sampleLoaded: data.wines.some((w) => w.isSample),
    isEmpty: data.wines.length === 0,
  };
}

// ---------- stats ----------

export interface SeriesPoint {
  key: string;
  label: string;
  value: number;
}

export interface CellarStats {
  byColour: SeriesPoint[];
  byCountry: SeriesPoint[];
  byRegion: SeriesPoint[];
  byVintageDecade: SeriesPoint[];
  byStatus: SeriesPoint[];
  /** Bottles drunk per month for the last 12 months, oldest first; keys are "YYYY-MM". */
  drunkPerMonth: SeriesPoint[];
}

function tally(rows: CellarRow[], keyOf: (r: CellarRow) => string, labelOf = (k: string) => k) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + row.bottles);
  return [...totals]
    .map(([key, value]) => ({ key, label: labelOf(key), value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export async function getStats(
  year: number = currentYear(),
  today: Date = new Date(nowIso()),
): Promise<CellarStats> {
  const data = await loadCellar();
  const rows = buildRows(data, year).filter((r) => r.bottles > 0);

  const months: SeriesPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(d);
    months.push({ key, label, value: 0 });
  }
  // Only drinks from the first month of the window on can land in it ("YYYY-MM" sorts before its days).
  const consumptions = await db.consumptions
    .where("date")
    .aboveOrEqual(months[0]?.key ?? "")
    .toArray();
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const c of consumptions) {
    const index = monthIndex.get(c.date.slice(0, 7));
    const point = index === undefined ? undefined : months[index];
    if (point) point.value += c.quantity;
  }

  const colourOrder = (points: SeriesPoint[]) =>
    COLOURS.map((c) => points.find((p) => p.key === c)).filter((p): p is SeriesPoint => !!p);

  return {
    byColour: colourOrder(
      tally(
        rows,
        (r) => r.wine.colour,
        (k) => COLOUR_LABELS[k as Colour],
      ),
    ),
    byCountry: tally(rows, (r) => r.wine.country ?? "Unknown"),
    byRegion: tally(rows, (r) => r.wine.region ?? "Unknown"),
    byVintageDecade: tally(
      rows,
      (r) => (r.wine.vintage === null ? "nv" : `${Math.floor(r.wine.vintage / 10) * 10}s`),
      (k) => (k === "nv" ? "NV" : k),
    ).sort((a, b) => (a.key === "nv" ? 1 : b.key === "nv" ? -1 : a.key.localeCompare(b.key))),
    byStatus: WINDOW_STATUSES.map((status) => ({
      key: status,
      label: WINDOW_STATUS_LABELS[status],
      value: rows.filter((r) => r.status === status).reduce((sum, r) => sum + r.bottles, 0),
    })),
    drunkPerMonth: months,
  };
}

// ---------- history, deleted, locations, wishlist ----------

/** Event batches, newest first. */
export async function getHistory(limit = 200): Promise<EventBatch[]> {
  return db.eventBatches.orderBy("createdAt").reverse().limit(limit).toArray();
}

export interface DeletedWine {
  wine: Wine;
  deletedAt: string;
  /** Date (YYYY-MM-DD) the wine is purged for good. */
  purgeOn: string;
}

/** Wines deleted in the last 30 days, most recent first (KTD8). */
export async function getRecentlyDeleted(): Promise<DeletedWine[]> {
  const day = 86_400_000;
  const wines = await db.wines.where("deletedAt").above("").toArray();
  return wines
    .filter((w): w is Wine & { deletedAt: string } => !!w.deletedAt)
    .map((wine) => ({
      wine,
      deletedAt: wine.deletedAt,
      purgeOn: new Date(Date.parse(wine.deletedAt) + PURGE_AFTER_DAYS * day)
        .toISOString()
        .slice(0, 10),
    }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function getLocations(): Promise<Location[]> {
  return (await db.locations.toArray()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface LocationWithCounts {
  location: Location;
  bottles: number;
  openLots: number;
  wines: number;
  /** Bottles here of wines in Recently deleted: not in the cellar, but they block deleting it. */
  deletedBottles: number;
}

const sumQuantity = (lots: Lot[]) => lots.reduce((sum, l) => sum + l.quantity, 0);

/** Locations sorted by name with what they hold. */
export async function getLocationsWithCounts(): Promise<LocationWithCounts[]> {
  const { wines, lots } = await loadCellar();
  const live = new Set(wines.map((w) => w.id));
  const deletedIds = new Set(
    (await db.wines.filter((w) => Boolean(w.deletedAt)).toArray()).map((w) => w.id),
  );
  const open = lots.filter((l) => l.quantity > 0);
  return (await getLocations()).map((location) => {
    const at = open.filter((l) => l.locationId === location.id);
    const here = at.filter((l) => live.has(l.wineId));
    const deleted = at.filter((l) => deletedIds.has(l.wineId));
    return {
      location,
      bottles: sumQuantity(here),
      openLots: here.length,
      wines: new Set(here.map((l) => l.wineId)).size,
      deletedBottles: sumQuantity(deleted),
    };
  });
}

/** Wishlist items, newest first. */
export async function getWishlist(): Promise<WishlistItem[]> {
  return db.wishlist.orderBy("createdAt").reverse().toArray();
}

// ---------- hooks ----------

/** Live cellar list; undefined while loading. */
export function useCellarList(query: CellarQuery = {}): CellarRow[] | undefined {
  const deps = JSON.stringify(query);
  return useLiveQuery(() => getCellarList(JSON.parse(deps) as CellarQuery), [deps]);
}

/** Live wine detail; undefined while loading, null when the wine is missing or deleted. */
export function useWineDetail(wineId: string | undefined): WineDetail | null | undefined {
  return useLiveQuery(
    async () => (wineId ? ((await getWineDetail(wineId)) ?? null) : null),
    [wineId],
  );
}

export function useHomeSections(): HomeSections | undefined {
  return useLiveQuery(() => getHomeSections(), []);
}

export function useStats(): CellarStats | undefined {
  return useLiveQuery(() => getStats(), []);
}

export function useRecentlyDeleted(): DeletedWine[] | undefined {
  return useLiveQuery(() => getRecentlyDeleted(), []);
}

export function useLocations(): Location[] | undefined {
  return useLiveQuery(() => getLocations(), []);
}

export function useLocationsWithCounts(): LocationWithCounts[] | undefined {
  return useLiveQuery(() => getLocationsWithCounts(), []);
}

export function useWishlist(): WishlistItem[] | undefined {
  return useLiveQuery(() => getWishlist(), []);
}

export function useFilterOptions(): { countries: string[]; regions: string[] } | undefined {
  return useLiveQuery(() => getFilterOptions(), []);
}
