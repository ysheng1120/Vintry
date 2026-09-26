import type { ImportField } from "../../ai/features/mapCsv";
import type { WineDraft } from "../../domain/commands/schemas";
import { normalizeName } from "../../domain/match";
import { parseLocaleNumber } from "../../lib/csv";
import { toIsoDate } from "../../lib/format";
import {
  normalizeColour,
  normalizeVintage,
  normalizeWindowYear,
  parseBottleSizeMl,
  type CsvMapping,
  type ImportSourceId,
} from "./presets";

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
  draft: WineDraft | null;
  issues: RowIssue[];
}

export interface ImportPreview {
  /** One entry per CSV data row, in file order. */
  rows: ImportRow[];
  /** Ready for `importRows({ rows: drafts })`. */
  drafts: WineDraft[];
  includedCount: number;
  skippedCount: number;
  bottleCount: number;
}

export interface BuildImportRowsOptions {
  source: ImportSourceId;
  mapping: CsvMapping;
  /** Used for a row whose Location cell doesn't match an existing location, or has none. */
  defaultLocationId: string | null;
  /** Used when a row's Currency cell is blank or unreadable. */
  defaultCurrency: string | null;
  /** Existing locations, matched to a row's Location cell by name (case- and accent-insensitive). */
  locations?: { id: string; name: string }[];
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

  const result: ImportRow[] = [];
  const drafts: WineDraft[] = [];
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

    const name = cell(row, options.mapping, "name");
    const vintage = normalizeVintage(cell(row, options.mapping, "vintage"));

    const colourRaw = cell(row, options.mapping, "colour");
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
      if (bottleSize === undefined) {
        warn("bottleSize", `Bottle size "${bottleSizeRaw}" not recognised; used 750 ml`);
      }
    }

    let windowFrom = normalizeWindowYear(cell(row, options.mapping, "windowFrom"));
    let windowTo = normalizeWindowYear(cell(row, options.mapping, "windowTo"));
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
    let quantity = 1;
    if (quantityRaw) {
      const parsed = parseLocaleNumber(quantityRaw);
      if (parsed === null || parsed < 1) {
        warn("quantity", `Quantity "${quantityRaw}" isn't a whole number; assumed 1 bottle`);
      } else {
        quantity = Math.round(parsed);
      }
    }

    const locationRaw = cell(row, options.mapping, "location");
    const matchedLocationId = locationRaw
      ? locationByName.get(normalizeName(locationRaw))
      : undefined;
    const locationId = matchedLocationId ?? options.defaultLocationId;

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

    const draft: WineDraft = {
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

    drafts.push(draft);
    bottleCount += quantity;
    result.push({ rowIndex, draft, issues });
  });

  return {
    rows: result,
    drafts,
    includedCount: drafts.length,
    skippedCount: result.length - drafts.length,
    bottleCount,
  };
}
