import type { ImportField } from "../../ai/features/mapCsv";
import type { Colour } from "../../domain/types";

export type ImportSourceId = "cellartracker" | "vivino" | "generic";

export const IMPORT_SOURCE_LABELS: Record<ImportSourceId, string> = {
  cellartracker: "CellarTracker",
  vivino: "Vivino",
  generic: "Generic CSV",
};

export type CsvMapping = Partial<Record<ImportField, string>>;

interface Preset {
  id: Exclude<ImportSourceId, "generic">;
  /** True when these headers look like this preset's export. */
  detect(headers: string[]): boolean;
  /** Field -> CSV header, choosing from the headers actually present. */
  mapping(headers: string[]): CsvMapping;
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const lower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  for (const candidate of candidates) {
    const match = lower.get(candidate.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function buildMapping(
  headers: string[],
  candidates: Partial<Record<ImportField, string[]>>,
): CsvMapping {
  const mapping: CsvMapping = {};
  for (const [field, names] of Object.entries(candidates) as [ImportField, string[]][]) {
    const header = findHeader(headers, names);
    if (header) mapping[field] = header;
  }
  return mapping;
}

const cellarTrackerPreset: Preset = {
  id: "cellartracker",
  // "iWine" is CellarTracker's own internal id and appears in every one of its exports; the
  // combination of Producer, Wine, and Vintage is the next-strongest signal.
  detect(headers) {
    const has = (name: string) => findHeader(headers, [name]) !== undefined;
    if (has("iWine")) return true;
    return has("Producer") && has("Wine") && has("Vintage") && (has("Locale") || has("Country"));
  },
  mapping(headers) {
    return buildMapping(headers, {
      producer: ["Producer"],
      name: ["Wine"],
      vintage: ["Vintage"],
      colour: ["Color", "Category", "Type"],
      country: ["Country"],
      region: ["Region"],
      appellation: ["Appellation"],
      grapes: ["Varietal", "MasterVarietal"],
      bottleSize: ["Size"],
      quantity: ["Quantity"],
      location: ["Location"],
      bin: ["Bin"],
      pricePerBottle: ["Price"],
      currency: ["Currency"],
      windowFrom: ["BeginConsume"],
      windowTo: ["EndConsume"],
      rating: ["PScore"],
      notes: ["PNotes"],
      purchaseDate: ["PurchaseDate", "Purchase Date"],
      store: ["StoreName", "Store"],
    });
  },
};

/**
 * CellarTracker spreads a wine's style over three columns: Color says red or white, while
 * Category and Type say sparkling, sweet/dessert, or fortified. Reading Color alone makes
 * Champagne white and Port red, so the importer reads all three together.
 */
export const CELLARTRACKER_STYLE_HEADERS = ["Type", "Category", "Color"] as const;

/** The CellarTracker row's style columns joined, most specific first ("" when none). */
export function cellarTrackerStyleText(row: Record<string, string>): string {
  const byName = new Map(Object.keys(row).map((key) => [key.trim().toLowerCase(), key]));
  return CELLARTRACKER_STYLE_HEADERS.map((name) => {
    const key = byName.get(name.toLowerCase());
    return key ? (row[key] ?? "").trim() : "";
  })
    .filter(Boolean)
    .join(" ");
}

/** CellarTracker's count of bottles on order (not delivered yet), or 0. */
export function cellarTrackerPending(row: Record<string, string>): number {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === "pending");
  const value = key ? Number.parseInt((row[key] ?? "").trim(), 10) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** CellarTracker's own wine id (its `iWine` column), or null when the row has none. */
export function cellarTrackerWineId(row: Record<string, string>): string | null {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === "iwine");
  const value = key ? (row[key] ?? "").trim() : "";
  return value || null;
}

const vivinoPreset: Preset = {
  id: "vivino",
  detect(headers) {
    const has = (name: string) => findHeader(headers, [name]) !== undefined;
    return has("Winery") && (has("Wine name") || has("Wine Name"));
  },
  mapping(headers) {
    return buildMapping(headers, {
      producer: ["Winery"],
      name: ["Wine name", "Wine Name"],
      vintage: ["Vintage"],
      colour: ["Wine type", "Wine Type"],
      country: ["Country"],
      region: ["Region"],
      rating: ["Your rating", "Your Rating"],
      notes: ["Personal note", "Personal Note", "Your review", "Your Review"],
      purchaseDate: ["Scan date", "Scan Date"],
      pricePerBottle: ["Wine price", "Wine Price"],
    });
  },
};

const PRESETS: Preset[] = [cellarTrackerPreset, vivinoPreset];

/** Detects CellarTracker or Vivino from a file's headers, else "generic" (R20). */
export function detectImportSource(headers: string[]): ImportSourceId {
  return PRESETS.find((preset) => preset.detect(headers))?.id ?? "generic";
}

/** The built-in header mapping for a detected preset; empty for "generic" (needs a mapping). */
export function presetMapping(source: ImportSourceId, headers: string[]): CsvMapping {
  return PRESETS.find((preset) => preset.id === source)?.mapping(headers) ?? {};
}

// ---------- value normalisers (KTD13) ----------

const COLOUR_PATTERNS: [RegExp, Colour][] = [
  [/sparkl|champagne|mousseux|spumante|cava|prosecco|cr[ée]mant/i, "sparkling"],
  [
    /dessert|sweet wine|noble|late harvest|passito|liquoreux|s[üu]ss|ice ?wine|sauternes/i,
    "dessert",
  ],
  [/fortif|port|sherry|madeira|marsala|vermouth/i, "fortified"],
  [/orange|amber|skin.?contact/i, "orange"],
  [/ros[ée]|rosato|rosado/i, "rose"],
  [/white|blanc|bianco|wei(ss|ß)|branco/i, "white"],
  [/red|rouge|rosso|tinto|rot\b/i, "red"],
];

/**
 * Maps a colour/category cell to a Vintry colour (English, French, and Italian words) or null
 * when nothing recognisable is found.
 */
export function normalizeColour(raw: string | null | undefined): Colour | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  for (const [pattern, colour] of COLOUR_PATTERNS) {
    if (pattern.test(text)) return colour;
  }
  return null;
}

/** CellarTracker's `1001` vintage sentinel means non-vintage; other values parse as a year. */
export function normalizeVintage(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n === 1001) return null;
  return n;
}

/** CellarTracker's `9999` drinking-window sentinel means no window; other values parse as a year. */
export function normalizeWindowYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n === 9999) return null;
  return n;
}

const NAMED_BOTTLE_SIZES_ML: Record<string, number> = {
  split: 187,
  piccolo: 187,
  quarter: 187,
  half: 375,
  "half bottle": 375,
  demi: 375,
  "demi bottle": 375,
  standard: 750,
  bottle: 750,
  magnum: 1500,
  "double magnum": 3000,
  jeroboam: 3000,
  rehoboam: 4500,
  methuselah: 6000,
  salmanazar: 9000,
  balthazar: 12000,
  nebuchadnezzar: 15000,
};

/** Parses a bottle size cell ("750ml", "Magnum", "1.5L") into millilitres. */
export function parseBottleSizeMl(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  const named = NAMED_BOTTLE_SIZES_ML[text];
  if (named) return named;
  const match = /^([\d.,]+)\s*(ml|millilit\w*|cl|centilit\w*|l|litre?s?|liters?)?$/i.exec(text);
  if (!match) return undefined;
  const amount = Number.parseFloat((match[1] ?? "").replace(",", "."));
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? "ml").toLowerCase();
  if (unit.startsWith("l")) return Math.round(amount * 1000);
  if (unit.startsWith("cl") || unit.startsWith("centilit")) return Math.round(amount * 10);
  return Math.round(amount);
}
