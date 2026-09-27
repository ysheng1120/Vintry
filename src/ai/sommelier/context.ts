import { db } from "../../db/db";
import { currentYear, now } from "../../domain/clock";
import { COLOUR_LABELS, type Location, type Lot, type Wine } from "../../domain/types";
import { wineLabel } from "../../domain/labels";
import {
  WINDOW_STATUSES,
  WINDOW_STATUS_LABELS,
  windowRange,
  windowStatus,
} from "../../domain/window";
import { toIsoDate } from "../../lib/format";

/**
 * Per-turn context (KTD12): a cellar snapshot and the screen the user came from. It is sent as
 * a new message each turn, never by editing the system prompt or earlier turns.
 */

/** The full lot table goes into context only up to this many open lots. */
export const LOT_TABLE_LIMIT = 200;

/** What the user was looking at when they asked, from `/sommelier?wine=<id>`. */
export interface ScreenContext {
  wineId?: string | null;
}

function windowText(wine: Wine): string {
  if (wine.windowFrom === null && wine.windowTo === null) return "none";
  const range = windowRange(wine.windowFrom, wine.windowTo);
  return wine.windowSource === "ai" ? `${range} (AI estimate)` : range;
}

function lotRow(lot: Lot, wine: Wine, locations: Map<string, Location>, year: number): string {
  const location = lot.locationId ? (locations.get(lot.locationId)?.name ?? "Unknown") : "None";
  return [
    lot.id,
    wine.id,
    wineLabel(wine),
    COLOUR_LABELS[wine.colour],
    location,
    lot.bin ?? "",
    String(lot.quantity),
    WINDOW_STATUS_LABELS[windowStatus(wine, year)],
    windowText(wine),
  ].join(" | ");
}

/** The cellar snapshot text: date, totals, locations, status counts, and lots when few enough. */
export async function buildCellarSnapshot(): Promise<string> {
  const year = currentYear();
  const [allWines, lots, locationRows] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.locations.toArray(),
  ]);
  const wines = new Map(allWines.filter((w) => !w.deletedAt).map((w) => [w.id, w]));
  const locations = new Map(locationRows.map((l) => [l.id, l]));
  const open = lots
    .filter((lot) => lot.quantity > 0 && wines.has(lot.wineId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const bottleCount = open.reduce((sum, lot) => sum + lot.quantity, 0);
  const wineIds = new Set(open.map((lot) => lot.wineId));
  const statusCounts = new Map<string, number>(WINDOW_STATUSES.map((s) => [s, 0]));
  for (const id of wineIds) {
    const wine = wines.get(id);
    if (wine) {
      const status = windowStatus(wine, year);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
  }

  const lines = [
    `Cellar snapshot, ${toIsoDate(now())}.`,
    `Totals: ${bottleCount} bottles of ${wineIds.size} wines in ${open.length} open lots.`,
    `Wines by drinking window: ${WINDOW_STATUSES.map(
      (s) => `${WINDOW_STATUS_LABELS[s]} ${statusCounts.get(s) ?? 0}`,
    ).join(", ")}.`,
  ];

  const sortedLocations = [...locations.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (sortedLocations.length === 0) lines.push("Locations: none defined.");
  else {
    lines.push("Locations (name | location id | bottles):");
    for (const location of sortedLocations) {
      const here = open.filter((lot) => lot.locationId === location.id);
      lines.push(`${location.name} | ${location.id} | ${here.reduce((s, l) => s + l.quantity, 0)}`);
    }
  }

  if (open.length === 0) {
    lines.push("There are no bottles in the cellar.");
  } else if (open.length <= LOT_TABLE_LIMIT) {
    lines.push(
      "Open lots (lot id | wine id | wine | colour | location | bin | bottles | status | window):",
    );
    for (const lot of open) {
      const wine = wines.get(lot.wineId);
      if (wine) lines.push(lotRow(lot, wine, locations, year));
    }
  } else {
    lines.push(
      `The lot table is left out because the cellar has more than ${LOT_TABLE_LIMIT} open lots. Use search_cellar and get_wine to find bottles.`,
    );
  }
  return lines.join("\n");
}

/** One line about the current screen, or null when there is nothing specific in view. */
export async function describeScreen(screen: ScreenContext | undefined): Promise<string | null> {
  const wineId = screen?.wineId;
  if (!wineId) return null;
  const wine = await db.wines.get(wineId);
  if (!wine || wine.deletedAt) return null;
  return `Current screen: the user opened the sommelier from the wine ${wineLabel(wine)} (wine id ${wine.id}). Questions like "this wine" mean this one.`;
}
