import { z } from "zod";
import { db } from "../../db/db";
import { wineLabel } from "../../domain/labels";
import {
  getCellarList,
  getLocationsWithCounts,
  getStats,
  getWineDetail,
  type CellarRow,
} from "../../domain/selectors";
import { COLOURS } from "../../domain/types";
import { WINDOW_STATUSES, WINDOW_STATUS_LABELS } from "../../domain/window";
import { pluralize } from "../../lib/format";

/**
 * Read tools (KTD11): they run at once, change nothing, and read through the same selectors
 * the screens use. Each returns JSON for Claude plus a short chip line for the chat.
 */

export interface ReadOutcome {
  content: string;
  isError: boolean;
  chip: string | null;
  /** Wines to show as cards (show_bottles only). */
  wineIds: string[];
}

export const readToolSchemas = {
  search_cellar: z.object({
    query: z
      .string()
      .optional()
      .describe("Words to find in producer, name, region, country, appellation, grapes or vintage"),
    colours: z.array(z.enum(COLOURS)).optional().describe("Only these colours"),
    statuses: z
      .array(z.enum(WINDOW_STATUSES))
      .optional()
      .describe('Only these drinking-window statuses ("none" means no window)'),
    locationId: z.string().optional().describe("Only bottles at this location id"),
    includeDrunk: z
      .boolean()
      .optional()
      .describe("Also return wines with no bottles left (for history questions)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Most results to return, default 20"),
  }),
  get_wine: z.object({
    wineId: z.string().min(1).describe("Wine id"),
  }),
  list_locations: z.object({}),
  cellar_stats: z.object({}),
  get_consumption_history: z.object({
    wineId: z.string().optional().describe("Only this wine; leave out for all wines"),
    limit: z.number().int().min(1).max(100).optional().describe("Most entries, default 20"),
  }),
  show_bottles: z.object({
    wineIds: z
      .array(z.string())
      .min(1)
      .max(12)
      .describe("Wine ids to show as cards, in the order you mention them"),
  }),
} as const;

export type ReadToolName = keyof typeof readToolSchemas;

export const readToolDescriptions: Record<ReadToolName, string> = {
  search_cellar:
    "Search the collector's cellar. Returns matching wines with their open lots (lot ids, bottles, location). By default only wines with bottles left.",
  get_wine:
    "Read one wine in full: details, drinking window, open lots with ids and quantities, recent drinking and tasting notes.",
  list_locations: "List the storage locations with their ids and how many bottles each holds.",
  cellar_stats:
    "Bottle counts by colour, country, region, vintage decade and window status, and bottles drunk per month over the last year.",
  get_consumption_history: "Bottles drunk, newest first, with date, rating and occasion.",
  show_bottles:
    "Show wines from the cellar as cards the collector can open. Use it for every bottle you recommend or discuss. Unknown or empty wines are left out.",
};

const json = (value: unknown) => JSON.stringify(value);

function rowSummary(row: CellarRow, lotsByWine: Map<string, LotInfo[]>) {
  const { wine } = row;
  return {
    wineId: wine.id,
    wine: wineLabel(wine),
    colour: wine.colour,
    country: wine.country,
    region: wine.region,
    appellation: wine.appellation,
    grapes: wine.grapes,
    status: WINDOW_STATUS_LABELS[row.status],
    window: windowInfo(wine),
    bottles: row.bottles,
    lots: lotsByWine.get(wine.id) ?? [],
  };
}

function windowInfo(wine: {
  windowFrom: number | null;
  windowTo: number | null;
  windowSource: string | null;
}) {
  if (wine.windowFrom === null && wine.windowTo === null) return null;
  return { from: wine.windowFrom, to: wine.windowTo, source: wine.windowSource };
}

interface LotInfo {
  lotId: string;
  bottles: number;
  location: string | null;
  locationId: string | null;
  bin: string | null;
}

/** Open lots of the given wines, with location names. */
export async function openLotsByWine(wineIds: string[]): Promise<Map<string, LotInfo[]>> {
  const [lots, locations] = await Promise.all([
    db.lots.where("wineId").anyOf(wineIds).toArray(),
    db.locations.toArray(),
  ]);
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const byWine = new Map<string, LotInfo[]>();
  for (const lot of lots.filter((l) => l.quantity > 0).sort((a, b) => b.quantity - a.quantity)) {
    const list = byWine.get(lot.wineId) ?? [];
    list.push({
      lotId: lot.id,
      bottles: lot.quantity,
      location: lot.locationId ? (names.get(lot.locationId) ?? "Unknown location") : null,
      locationId: lot.locationId,
      bin: lot.bin,
    });
    byWine.set(lot.wineId, list);
  }
  return byWine;
}

type Input<N extends ReadToolName> = z.output<(typeof readToolSchemas)[N]>;

async function searchCellar(input: Input<"search_cellar">): Promise<ReadOutcome> {
  const rows = await getCellarList({
    search: input.query,
    colours: input.colours,
    statuses: input.statuses,
    locationIds: input.locationId ? [input.locationId] : undefined,
    includeDrunk: input.includeDrunk,
  });
  const limit = input.limit ?? 20;
  const shown = rows.slice(0, limit);
  const lots = await openLotsByWine(shown.map((r) => r.wine.id));
  return {
    content: json({
      matches: rows.length,
      ...(rows.length > limit ? { note: `Showing the first ${limit}. Narrow the search.` } : {}),
      wines: shown.map((row) => rowSummary(row, lots)),
    }),
    isError: false,
    chip: `Searched cellar: ${pluralize(rows.length, "match", "matches")}`,
    wineIds: [],
  };
}

async function getWine({ wineId }: Input<"get_wine">): Promise<ReadOutcome> {
  const detail = await getWineDetail(wineId);
  if (!detail) {
    return {
      content: `No wine has id ${wineId}. Search the cellar again.`,
      isError: true,
      chip: null,
      wineIds: [],
    };
  }
  const { wine } = detail;
  return {
    content: json({
      wineId: wine.id,
      wine: wineLabel(wine),
      producer: wine.producer,
      name: wine.name,
      vintage: wine.vintage,
      colour: wine.colour,
      country: wine.country,
      region: wine.region,
      appellation: wine.appellation,
      grapes: wine.grapes,
      bottleSize: wine.bottleSize,
      status: WINDOW_STATUS_LABELS[detail.status],
      window: windowInfo(wine),
      windowNote: wine.windowNote,
      rating: wine.rating,
      notes: wine.notes,
      bottles: detail.bottles,
      lots: detail.lots.map((lot) => ({
        lotId: lot.id,
        bottles: lot.quantity,
        location: lot.locationName,
        locationId: lot.locationId,
        bin: lot.bin,
        purchaseDate: lot.purchaseDate,
        pricePerBottle: lot.pricePerBottle,
        currency: lot.currency,
      })),
      recentlyDrunk: detail.consumptions.slice(0, 5).map((c) => ({
        date: c.date,
        bottles: c.quantity,
        rating: c.rating,
        occasion: c.occasion,
      })),
      tastingNotes: detail.notes.slice(0, 5).map((n) => ({
        date: n.date,
        text: n.text,
        rating: n.rating,
      })),
    }),
    isError: false,
    chip: `Read ${wineLabel(wine)}`,
    wineIds: [],
  };
}

async function listLocations(): Promise<ReadOutcome> {
  const locations = await getLocationsWithCounts();
  return {
    content: json({
      locations: locations.map((l) => ({
        locationId: l.location.id,
        name: l.location.name,
        bottles: l.bottles,
        wines: l.wines,
      })),
    }),
    isError: false,
    chip: `Listed ${pluralize(locations.length, "location")}`,
    wineIds: [],
  };
}

async function cellarStats(): Promise<ReadOutcome> {
  const stats = await getStats();
  const points = (list: { label: string; value: number }[]) =>
    Object.fromEntries(list.map((p) => [p.label, p.value]));
  return {
    content: json({
      bottlesByColour: points(stats.byColour),
      bottlesByCountry: points(stats.byCountry),
      bottlesByRegion: points(stats.byRegion),
      bottlesByVintageDecade: points(stats.byVintageDecade),
      bottlesByStatus: points(stats.byStatus),
      drunkPerMonth: Object.fromEntries(stats.drunkPerMonth.map((p) => [p.key, p.value])),
    }),
    isError: false,
    chip: "Checked cellar stats",
    wineIds: [],
  };
}

async function consumptionHistory(input: Input<"get_consumption_history">): Promise<ReadOutcome> {
  const all = input.wineId
    ? await db.consumptions.where("wineId").equals(input.wineId).toArray()
    : await db.consumptions.toArray();
  const sorted = all.sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  const entries = sorted.slice(0, input.limit ?? 20);
  const wines = new Map(
    (await db.wines.bulkGet([...new Set(entries.map((c) => c.wineId))]))
      .filter((w) => w !== undefined)
      .map((w) => [w.id, w]),
  );
  return {
    content: json({
      total: all.length,
      entries: entries.map((c) => {
        const wine = wines.get(c.wineId);
        return {
          date: c.date,
          wineId: c.wineId,
          wine: wine ? wineLabel(wine) : "Unknown wine",
          bottles: c.quantity,
          rating: c.rating,
          occasion: c.occasion,
        };
      }),
    }),
    isError: false,
    chip: `Checked drinking history: ${pluralize(all.length, "entry", "entries")}`,
    wineIds: [],
  };
}

async function showBottles({ wineIds }: Input<"show_bottles">): Promise<ReadOutcome> {
  const unique = [...new Set(wineIds)];
  const rows = await getCellarList({ includeDrunk: true });
  const byId = new Map(rows.map((row) => [row.wine.id, row]));
  // Only wines that exist with bottles left become cards (R14); others are dropped silently.
  const shown = unique
    .map((id) => byId.get(id))
    .filter((row): row is CellarRow => row !== undefined && row.bottles > 0);
  return {
    content: json({
      shown: shown.map((row) => ({
        wineId: row.wine.id,
        wine: wineLabel(row.wine),
        bottles: row.bottles,
      })),
    }),
    isError: false,
    chip: null,
    wineIds: shown.map((row) => row.wine.id),
  };
}

export function isReadTool(name: string): name is ReadToolName {
  return Object.hasOwn(readToolSchemas, name);
}

/** Validates the input and runs a read tool. Never throws. */
export async function runReadTool(name: ReadToolName, rawInput: unknown): Promise<ReadOutcome> {
  const parsed = readToolSchemas[name].safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
      isError: true,
      chip: null,
      wineIds: [],
    };
  }
  try {
    switch (name) {
      case "search_cellar":
        return await searchCellar(parsed.data as Input<"search_cellar">);
      case "get_wine":
        return await getWine(parsed.data as Input<"get_wine">);
      case "list_locations":
        return await listLocations();
      case "cellar_stats":
        return await cellarStats();
      case "get_consumption_history":
        return await consumptionHistory(parsed.data as Input<"get_consumption_history">);
      case "show_bottles":
        return await showBottles(parsed.data as Input<"show_bottles">);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { content: `The tool failed: ${message}`, isError: true, chip: null, wineIds: [] };
  }
}
