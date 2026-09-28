import type { ImportField } from "../../ai/features/mapCsv";
import type { ImportDraft } from "../../domain/commands/schemas";
import { normalizeName } from "../../domain/match";
import { parseLocaleNumber } from "../../lib/csv";
import { toIsoDate } from "../../lib/format";
import { newId } from "../../lib/id";
import {
  CELLARTRACKER_STYLE_HEADERS,
  cellarTrackerPending,
  cellarTrackerWineId,
  cellarTrackerStyleText,
  normalizeColour,
  normalizeVintage,
  normalizeWindowYear,
  parseBottleSizeMl,
  type CsvMapping,
  type ImportSourceId,
} from "./presets";

// Matches YearSchema in src/domain/types.ts; a year outside this range fails importRows'
// zod validation for the whole batch, so it must be cleared here first (with a warning).
const MIN_YEAR = 1800;
const MAX_YEAR = 2200;

export type RowIssueKind = "skipped" | "warning";

export interface RowIssue {
  rowIndex: number;
  kind: RowIssueKind;
  field?: ImportField;
  message: string;
}

export interface ImportRow {
  rowIndex: number;
  /** null when the row is skipped; see `issues` for why. */
  draft: ImportDraft | null;
  issues: RowIssue[];
}

export interface ImportPreview {
  /** One entry per CSV data row, in file order. */
  rows: ImportRow[];
  /** Ready for `importRows({ rows: drafts, newLocations })`. */
  drafts: ImportDraft[];
  /**
   * Locations the file names that Vintry does not have yet, in file order. Lots point at them by
   * `id`; `importRows` creates them with the bottles.
   */
  newLocations: { id: string; name: string }[];
  includedCount: number;
  skippedCount: number;
  bottleCount: number;
}

export interface BuildImportRowsOptions {
  source: ImportSourceId;
  mapping: CsvMapping;
  /** Used for a row with no Location cell of its own. */
  defaultLocationId: string | null;
  /** Used when a row's Currency cell is blank or unreadable. */
  defaultCurrency: string | null;
  /**
   * Existing locations, matched to a row's Location cell by name (case- and accent-insensitive).
   * A name with no match becomes a new location, so the file's racks are never lost.
   */
  locations?: { id: string; name: string }[];
  /** Makes ids for new locations; tests pass a fixed one. */
  makeId?: () => string;
}

/**
 * The cuvée name without the producer in front: CellarTracker's Wine column (and many
 * spreadsheets) repeats the producer, which would show as "Krug Krug Grande Cuvée". Matching
 * ignores case, accents, and punctuation. A name that is only the producer becomes "".
 */
export function withoutProducerPrefix(name: string, producer: string): string {
  const target = normalizeName(producer);
  if (!target || !normalizeName(name).startsWith(target)) return name;
  for (let i = 1; i <= name.length; i += 1) {
    if (normalizeName(name.slice(0, i)) !== target) continue;
    const next = name.charAt(i);
    // Only a whole-word prefix: "Krug" leaves "Krugerhof" alone.
    if (next && /[\p{L}\p{N}]/u.test(next)) return name;
    return name.slice(i).replace(/^[\s,;:–—-]+/u, "");
  }
  return name;
}

function cell(row: Record<string, string>, mapping: CsvMapping, field: ImportField): string {
  const header = mapping[field];
  if (!header) return "";
  return (row[header] ?? "").trim();
}

/** Accepts an ISO date as-is; otherwise tries to parse it and reformats it as ISO. */
function parseImportDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : toIsoDate(date);
}

/**
 * Applies a header mapping to parsed CSV rows, producing drafts for `importRows` (KTD13). A row
 * with no producer is skipped; a field whose value can't be read is cleared with a warning rather
 * than failing the whole import, so one bad row never blocks the rest.
 */
export function buildImportRows(
  rows: Record<string, string>[],
  options: BuildImportRowsOptions,
): ImportPreview {
  const locationByName = new Map(
    (options.locations ?? []).map((location) => [normalizeName(location.name), location.id]),
  );
  const makeId = options.makeId ?? newId;
  const newLocations: { id: string; name: string }[] = [];
  /** The location id for a Location cell: an existing one, else a new one named after the cell. */
  const locationIdFor = (raw: string): string => {
    const key = normalizeName(raw);
    const known = locationByName.get(key);
    if (known) return known;
    const created = { id: makeId(), name: raw.replace(/\s+/g, " ") };
    newLocations.push(created);
    locationByName.set(key, created.id);
    return created.id;
  };

  const result: ImportRow[] = [];
  const drafts: ImportDraft[] = [];
  let bottleCount = 0;

  rows.forEach((row, rowIndex) => {
    const producer = cell(row, options.mapping, "producer");
    if (!producer) {
      result.push({
        rowIndex,
        draft: null,
        issues: [
          { rowIndex, kind: "skipped", field: "producer", message: "No producer; row skipped" },
        ],
      });
      return;
    }

    const issues: RowIssue[] = [];
    const warn = (field: ImportField, message: string) =>
      issues.push({ rowIndex, kind: "warning", field, message });

    const name = withoutProducerPrefix(cell(row, options.mapping, "name"), producer);
    const vintageRaw = cell(row, options.mapping, "vintage");
    let vintage = normalizeVintage(vintageRaw);
    if (vintage != null && (vintage < MIN_YEAR || vintage > MAX_YEAR)) {
      warn("vintage", `Vintage "${vintageRaw}" isn't a year; left blank`);
      vintage = null;
    }

    // CellarTracker: read Type and Category with Color, so sparkling, dessert, and fortified
    // wines keep their style (unless the collector mapped the colour to another column).
    const ctStyle =
      options.source === "cellartracker" &&
      CELLARTRACKER_STYLE_HEADERS.some(
        (h) => h.toLowerCase() === options.mapping.colour?.trim().toLowerCase(),
      );
    const colourRaw = ctStyle ? cellarTrackerStyleText(row) : cell(row, options.mapping, "colour");
    let colour = normalizeColour(colourRaw);
    if (!colour) {
      if (colourRaw) warn("colour", `Colour "${colourRaw}" not recognised; set to Red`);
      colour = "red";
    }

    const country = cell(row, options.mapping, "country") || null;
    const region = cell(row, options.mapping, "region") || null;
    const appellation = cell(row, options.mapping, "appellation") || null;

    const grapesRaw = cell(row, options.mapping, "grapes");
    const grapes = grapesRaw
      ? grapesRaw
          .split(/[/,;]/)
          .map((g) => g.trim())
          .filter(Boolean)
      : [];

    const bottleSizeRaw = cell(row, options.mapping, "bottleSize");
    let bottleSize: number | undefined;
    if (bottleSizeRaw) {
      bottleSize = parseBottleSizeMl(bottleSizeRaw);
      if (bottleSize === undefined || bottleSize <= 0) {
        warn("bottleSize", `Bottle size "${bottleSizeRaw}" not recognised; used 750 ml`);
        bottleSize = undefined;
      }
    }

    const windowFromRaw = cell(row, options.mapping, "windowFrom");
    const windowToRaw = cell(row, options.mapping, "windowTo");
    let windowFrom = normalizeWindowYear(windowFromRaw);
    let windowTo = normalizeWindowYear(windowToRaw);
    if (windowFrom != null && (windowFrom < MIN_YEAR || windowFrom > MAX_YEAR)) {
      warn("windowFrom", `Drinking window start "${windowFromRaw}" isn't a year; left blank`);
      windowFrom = null;
    }
    if (windowTo != null && (windowTo < MIN_YEAR || windowTo > MAX_YEAR)) {
      warn("windowTo", `Drinking window end "${windowToRaw}" isn't a year; left blank`);
      windowTo = null;
    }
    if (windowFrom != null && windowTo != null && windowTo < windowFrom) {
      warn("windowTo", "Drinking window ends before it starts; window cleared");
      windowFrom = null;
      windowTo = null;
    }

    const ratingRaw = cell(row, options.mapping, "rating");
    let rating: number | null = null;
    if (ratingRaw) {
      const parsed = parseLocaleNumber(ratingRaw);
      if (parsed === null) {
        warn("rating", `Rating "${ratingRaw}" isn't a number; left blank`);
      } else {
        // Vivino rates on a 5-star scale; Vintry ratings are out of 100.
        const scaled = options.source === "vivino" && parsed <= 5 ? parsed * 20 : parsed;
        if (scaled < 0 || scaled > 100) {
          warn("rating", `Rating "${ratingRaw}" is out of range; left blank`);
        } else {
          rating = Math.round(scaled);
        }
      }
    }

    const notes = cell(row, options.mapping, "notes") || null;

    const quantityRaw = cell(row, options.mapping, "quantity");
    const pending = options.source === "cellartracker" ? cellarTrackerPending(row) : 0;
    let quantity = 1;
    if (quantityRaw) {
      const parsed = parseLocaleNumber(quantityRaw);
      if (parsed === 0) {
        // No bottles in the cellar: a CellarTracker row with only bottles on order (futures),
        // or a row for a wine already drunk. Importing it as 1 bottle would invent one.
        result.push({
          rowIndex,
          draft: null,
          issues: [
            {
              rowIndex,
              kind: "skipped",
              field: "quantity",
              message:
                pending > 0
                  ? `${pending} on order, none delivered yet; row skipped`
                  : "0 bottles; row skipped",
            },
          ],
        });
        return;
      }
      if (parsed === null || parsed < 1) {
        warn("quantity", `Quantity "${quantityRaw}" isn't a whole number; assumed 1 bottle`);
      } else {
        quantity = Math.round(parsed);
      }
    }
    if (pending > 0) {
      warn("quantity", `${pending} more on order were left out; add them when they arrive`);
    }

    const locationRaw = cell(row, options.mapping, "location");
    const locationId = locationRaw ? locationIdFor(locationRaw) : options.defaultLocationId;

    const bin = cell(row, options.mapping, "bin") || null;
    const store = cell(row, options.mapping, "store") || null;

    const priceRaw = cell(row, options.mapping, "pricePerBottle");
    let pricePerBottle: number | null = null;
    if (priceRaw) {
      pricePerBottle = parseLocaleNumber(priceRaw);
      if (pricePerBottle === null)
        warn("pricePerBottle", `Price "${priceRaw}" isn't a number; left blank`);
    }

    const currencyRaw = cell(row, options.mapping, "currency").toUpperCase();
    let currency = options.defaultCurrency;
    if (currencyRaw) {
      if (/^[A-Z]{3}$/.test(currencyRaw)) currency = currencyRaw;
      else warn("currency", `Currency "${currencyRaw}" isn't a 3-letter code; used the default`);
    }

    const purchaseDateRaw = cell(row, options.mapping, "purchaseDate");
    let purchaseDate: string | null = null;
    if (purchaseDateRaw) {
      purchaseDate = parseImportDate(purchaseDateRaw);
      if (purchaseDate === null)
        warn("purchaseDate", `Date "${purchaseDateRaw}" isn't recognised; left blank`);
    }

    const draft: ImportDraft = {
      producer,
      name,
      vintage,
      colour,
      country,
      region,
      appellation,
      grapes,
      ...(bottleSize !== undefined ? { bottleSize } : {}),
      windowFrom,
      windowTo,
      rating,
      notes,
      lots: [{ quantity, locationId, bin, purchaseDate, pricePerBottle, currency, store }],
    };
    // CellarTracker's own wine id, so the next export of this wine matches it even if renamed.
    const cellarTrackerId = options.source === "cellartracker" ? cellarTrackerWineId(row) : null;
    if (cellarTrackerId) draft.cellarTrackerId = cellarTrackerId;

    drafts.push(draft);
    bottleCount += quantity;
    result.push({ rowIndex, draft, issues });
  });

  return {
    rows: result,
    drafts,
    newLocations,
    includedCount: drafts.length,
    skippedCount: result.length - drafts.length,
    bottleCount,
  };
}
