import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { currentYear } from "./clock";
import { wineLabel } from "./labels";
import { sumByCurrency, type CurrencyTotal } from "./money";
import type { SeriesPoint } from "./selectors";
import {
  COLOURS,
  COLOUR_LABELS,
  type Colour,
  type Consumption,
  type Lot,
  type Wine,
} from "./types";

/**
 * "Year in wine": a yearly recap for the Stats page, plus a multi-year spending chart.
 *
 * Money and bottles-bought figures are drawn from lots, and (like the cellar cost on Home) only
 * count lots of wines that are not soft-deleted. A lot only records its current quantity, which
 * falls as bottles are drunk from it, so `boughtQuantity` below adds back what was ever drunk from
 * that lot to get a figure that does not shrink after the fact (see its own comment). The
 * bottles-drunk total is drawn straight from consumptions, unfiltered by wine deletion, the same
 * way `getStats`' `drunkPerMonth` already works: a drink stays part of history even after the wine
 * is later deleted. Breakdowns that name a wine (top wines, colours) need it to still exist, so a
 * deleted wine's drinks still count towards the total but drop out of those two. Sample-cellar
 * wines are not excluded anywhere here, matching the rest of the stats screen (Home only flags
 * that sample data is loaded; it does not hide it from charts).
 */

const yearOf = (isoDate: string): number => Number(isoDate.slice(0, 4));

/** Ids of wines that are not soft-deleted, for the money and bottle-bought figures. */
function liveWineIds(wines: Wine[]): Set<string> {
  return new Set(wines.filter((w) => !w.deletedAt).map((w) => w.id));
}

/**
 * How many bottles a lot originally held when bought, reconstructed so that later drinking (or
 * moving part of it, which splits it into a second lot) never changes the answer: a lot's current
 * quantity plus whatever was ever drunk straight from it (moving does not remove bottles, so the
 * two split lots' figures still add up to the original purchase). A manual quantity correction
 * (`adjustQuantity`, for a miscount) is not tracked this way and can shift this number slightly.
 */
function boughtQuantity(lot: Lot, consumedByLotId: Map<string, number>): number {
  return lot.quantity + (consumedByLotId.get(lot.id) ?? 0);
}

function consumedByLotId(consumptions: Consumption[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const c of consumptions) {
    if (!c.lotId) continue;
    totals.set(c.lotId, (totals.get(c.lotId) ?? 0) + c.quantity);
  }
  return totals;
}

/** Every year with a purchase or a drink recorded, newest first, for the year picker. */
export async function getYearsWithData(): Promise<number[]> {
  const [lots, consumptions] = await Promise.all([db.lots.toArray(), db.consumptions.toArray()]);
  const years = new Set<number>();
  for (const lot of lots) if (lot.purchaseDate) years.add(yearOf(lot.purchaseDate));
  for (const c of consumptions) years.add(yearOf(c.date));
  return [...years].sort((a, b) => b - a);
}

// ---------- year recap ----------

export interface YearTopWine {
  wineId: string;
  label: string;
  bottles: number;
}

export interface YearInWine {
  year: number;
  /** Bottles bought this year (a lot counts once it holds a purchase date in this year). */
  bottlesBought: number;
  /** Money spent buying bottles this year, one total per currency (never converted, R9). */
  spentByCurrency: CurrencyTotal[];
  bottlesDrunk: number;
  /** Most-drunk wines this year by bottles, at most 3, ties broken by name. */
  topWines: YearTopWine[];
  /** Average rating (0-100) of tasting notes written this year; null when none have a rating. */
  averageRating: number | null;
  /** Bottles drunk this year by colour, in the app's usual colour order; empty colours are left out. */
  byColour: SeriesPoint[];
}

export async function getYearInWine(year: number): Promise<YearInWine> {
  const [wines, lots, consumptions, notes] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.consumptions.toArray(),
    db.tastingNotes.toArray(),
  ]);
  const wineById = new Map(wines.map((w) => [w.id, w]));
  const liveIds = liveWineIds(wines);
  const consumed = consumedByLotId(consumptions);

  const boughtLots = lots.filter(
    (l) => l.purchaseDate && yearOf(l.purchaseDate) === year && liveIds.has(l.wineId),
  );
  const spentByCurrency = sumByCurrency(
    boughtLots.map((l) => ({
      amount: l.pricePerBottle === null ? null : l.pricePerBottle * boughtQuantity(l, consumed),
      currency: l.currency,
    })),
  );

  const drunk = consumptions.filter((c) => yearOf(c.date) === year);
  // The overall count stays true to history even for a wine deleted since, matching
  // `getStats`' `drunkPerMonth`; but a wine has to still exist to appear by name below.
  const bottlesDrunk = drunk.reduce((sum, c) => sum + c.quantity, 0);

  const drunkByWine = new Map<string, { wine: Wine; bottles: number }>();
  const drunkByColour = new Map<Colour, number>();
  for (const c of drunk) {
    const wine = wineById.get(c.wineId);
    if (!wine || wine.deletedAt) continue;
    const bottles = (drunkByWine.get(c.wineId)?.bottles ?? 0) + c.quantity;
    drunkByWine.set(c.wineId, { wine, bottles });
    drunkByColour.set(wine.colour, (drunkByColour.get(wine.colour) ?? 0) + c.quantity);
  }
  const topWines = [...drunkByWine.values()]
    .map(({ wine, bottles }) => ({ wineId: wine.id, label: wineLabel(wine), bottles }))
    .sort((a, b) => b.bottles - a.bottles || a.label.localeCompare(b.label))
    .slice(0, 3);
  const byColour = COLOURS.map((key) => ({
    key,
    label: COLOUR_LABELS[key],
    value: drunkByColour.get(key) ?? 0,
  })).filter((p) => p.value > 0);

  const ratedNotes = notes.filter((n) => yearOf(n.date) === year && n.rating !== null);
  const averageRating = ratedNotes.length
    ? Math.round(
        (ratedNotes.reduce((sum, n) => sum + (n.rating ?? 0), 0) / ratedNotes.length) * 10,
      ) / 10
    : null;

  return {
    year,
    bottlesBought: boughtLots.reduce((sum, l) => sum + boughtQuantity(l, consumed), 0),
    spentByCurrency,
    bottlesDrunk,
    topWines,
    averageRating,
    byColour,
  };
}

// ---------- spending per year ----------

/** How many recent years the spending chart shows at most. */
export const SPENDING_CHART_YEARS = 6;

export interface SpendingPerYear {
  /** The currency charted: whichever has the most spending across the years shown. Null with no purchases. */
  currency: string | null;
  /** One point per year with purchases, oldest first, at most `SPENDING_CHART_YEARS` of them. */
  points: SeriesPoint[];
  /** Other currencies spent in the years shown, for a short note under the chart. */
  otherCurrencies: string[];
}

export async function getSpendingPerYear(
  maxYears: number = SPENDING_CHART_YEARS,
): Promise<SpendingPerYear> {
  const [wines, lots, consumptions] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.consumptions.toArray(),
  ]);
  const liveIds = liveWineIds(wines);
  const consumed = consumedByLotId(consumptions);

  const byYear = new Map<number, Map<string, number>>();
  for (const lot of lots) {
    if (!lot.purchaseDate || lot.pricePerBottle === null || !lot.currency) continue;
    if (!liveIds.has(lot.wineId)) continue;
    const year = yearOf(lot.purchaseDate);
    const perCurrency = byYear.get(year) ?? new Map<string, number>();
    perCurrency.set(
      lot.currency,
      (perCurrency.get(lot.currency) ?? 0) + lot.pricePerBottle * boughtQuantity(lot, consumed),
    );
    byYear.set(year, perCurrency);
  }

  const years = [...byYear.keys()]
    .sort((a, b) => b - a)
    .slice(0, maxYears)
    .sort((a, b) => a - b);
  if (years.length === 0) return { currency: null, points: [], otherCurrencies: [] };

  const totalsByCurrency = new Map<string, number>();
  for (const year of years) {
    for (const [currency, amount] of byYear.get(year) ?? []) {
      totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + amount);
    }
  }
  const mainCurrency = [...totalsByCurrency].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const otherCurrencies = [...totalsByCurrency.keys()]
    .filter((c) => c !== mainCurrency)
    .sort((a, b) => a.localeCompare(b));

  const points = years.map((year) => {
    const amount = mainCurrency ? (byYear.get(year)?.get(mainCurrency) ?? 0) : 0;
    return { key: String(year), label: String(year), value: Math.round(amount * 100) / 100 };
  });

  return { currency: mainCurrency ?? null, points, otherCurrencies };
}

// ---------- hooks ----------

/** Live years with any purchase or drink recorded, newest first. */
export function useYearsWithData(): number[] | undefined {
  return useLiveQuery(() => getYearsWithData(), []);
}

/** Live year recap; `year` defaults to the current calendar year. */
export function useYearInWine(year: number = currentYear()): YearInWine | undefined {
  return useLiveQuery(() => getYearInWine(year), [year]);
}

export function useSpendingPerYear(
  maxYears: number = SPENDING_CHART_YEARS,
): SpendingPerYear | undefined {
  return useLiveQuery(() => getSpendingPerYear(maxYears), [maxYears]);
}
