import { z } from "zod";

/**
 * Entity schemas are the single source of truth for stored records (R1, KTD5, KTD9).
 * Optional values are stored as `null`, never left out, so rows round-trip through JSON backups.
 * Defaults let older or hand-made backups omit optional fields; required fields have none.
 */

export const COLOURS = [
  "red",
  "white",
  "rose",
  "sparkling",
  "dessert",
  "fortified",
  "orange",
] as const;
export const ColourSchema = z.enum(COLOURS);
export type Colour = z.infer<typeof ColourSchema>;

export const COLOUR_LABELS: Record<Colour, string> = {
  red: "Red",
  white: "White",
  rose: "Rosé",
  sparkling: "Sparkling",
  dessert: "Dessert",
  fortified: "Fortified",
  orange: "Orange",
};

export const WINDOW_SOURCES = ["user", "ai", "import"] as const;
export const WindowSourceSchema = z.enum(WINDOW_SOURCES);
export type WindowSource = z.infer<typeof WindowSourceSchema>;

export const EVENT_SOURCES = [
  "user",
  "ai-chat",
  "ai-scan",
  "ai-describe",
  "import",
  "restore",
  "sample",
] as const;
export const EventSourceSchema = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const DEFAULT_BOTTLE_SIZE = 750;

/** `YYYY-MM-DD` calendar date. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-09-26");
/** Four-digit year used for vintages and drinking windows. */
export const YearSchema = z.number().int().min(1800).max(2200);
/** ISO 4217 code such as GBP or USD. */
export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "must be a three-letter currency code like GBP");
/** Ratings use the 100-point scale. */
export const RatingSchema = z.number().min(0).max(100);

const base = {
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
};

const text = () => z.string().nullable().default(null);

/** An AI-written "About this wine" profile, from the wine's identity alone (never this bottle). */
export const WineProfileSchema = z.object({
  summary: z.string(),
  tasting: z.string(),
  pairings: z.array(z.string()).default([]),
  serving: z.string(),
  generatedAt: z.string(),
  model: z.string(),
});
export type WineProfile = z.infer<typeof WineProfileSchema>;

/** A web page an AI summary cites (critics, prices). The URL is shown only when it is http(s). */
export const CriticSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
});
export type CriticSource = z.infer<typeof CriticSourceSchema>;

/**
 * "What critics say": an AI summary of what published critics say about this wine and vintage,
 * researched on reputable wine sites. Every point and score keeps the page it came from; a
 * score is kept only when the cited text from that page shows it (checked in code).
 */
export const WineCriticsSchema = z.object({
  /** 2 to 3 plain sentences, or "" when nothing was found. */
  consensus: z.string(),
  points: z.array(z.object({ text: z.string(), sources: z.array(CriticSourceSchema) })).default([]),
  scores: z
    .array(
      z.object({
        critic: z.string(),
        publication: z.string(),
        /** As the source writes it, e.g. "94" or "17.5". */
        score: z.string(),
        /** "100" or "20". */
        scale: z.string(),
        source: CriticSourceSchema,
      }),
    )
    .default([]),
  /** False when no public critic reviews were found for this vintage. */
  found: z.boolean(),
  generatedAt: z.string(),
  model: z.string(),
});
export type WineCritics = z.infer<typeof WineCriticsSchema>;

/** What kind of price a source shows: a shop's offer, an average across shops, or an auction. */
export const PRICE_KINDS = ["retail", "average", "auction"] as const;
export const PriceKindSchema = z.enum(PRICE_KINDS);
export type PriceKind = z.infer<typeof PriceKindSchema>;

/**
 * "Suggested price": prices for this wine and vintage found on reputable price and merchant
 * sites. Display only: it never sets a lot's price or the collector's value. A price is kept
 * only when the text cited from its page shows that amount and currency (checked in code).
 * Currencies are never converted or mixed.
 */
export const WinePricesSchema = z.object({
  /** One short line without figures, or "" when there is none. */
  summary: z.string(),
  points: z
    .array(
      z.object({
        /** As the source writes it, e.g. "£1,250" or "1250.00". */
        price: z.string(),
        /** The amount read from `price` in code. */
        amount: z.number().positive(),
        currency: CurrencySchema,
        /** Bottle size in ml when the source states it. */
        bottleSize: z.number().int().positive().nullable().default(null),
        kind: PriceKindSchema,
        source: CriticSourceSchema,
      }),
    )
    .default([]),
  /** False when no prices were found for this wine and vintage. */
  found: z.boolean(),
  generatedAt: z.string(),
  model: z.string(),
});
export type WinePrices = z.infer<typeof WinePricesSchema>;

export const WineSchema = z.object({
  ...base,
  producer: z.string().min(1),
  /** Cuvée or wine name, "" when the producer name is the whole label. */
  name: z.string().default(""),
  /** null means non-vintage (NV). */
  vintage: YearSchema.nullable(),
  colour: ColourSchema,
  country: text(),
  region: text(),
  appellation: text(),
  grapes: z.array(z.string()).default([]),
  /** Bottle size in ml. A magnum is a different wine for matching (KTD5). */
  bottleSize: z.number().int().positive().default(DEFAULT_BOTTLE_SIZE),
  windowFrom: YearSchema.nullable().default(null),
  windowTo: YearSchema.nullable().default(null),
  windowSource: WindowSourceSchema.nullable().default(null),
  windowNote: text(),
  /** Small label image as a data URL. */
  thumbnail: text(),
  rating: RatingSchema.nullable().default(null),
  tags: z.array(z.string()).default([]),
  notes: text(),
  /**
   * Market value per bottle, entered by the collector only (never by AI). Set with its currency;
   * rows saved before values existed have none (read them with `wineValue`).
   */
  valuePerBottle: z.number().min(0).nullable().default(null),
  valueCurrency: CurrencySchema.nullable().default(null),
  /** When the collector last changed the value. */
  valueUpdatedAt: text(),
  deletedAt: text(),
  isSample: z.boolean().default(false),
  /** The "About this wine" AI profile, written from this wine's identity. Missing on older rows. */
  profile: WineProfileSchema.nullable().optional(),
  /** "What critics say", researched on the web from this wine's identity. Missing on older rows. */
  critics: WineCriticsSchema.nullable().optional(),
  /** "Suggested price", researched on the web from this wine's identity. Missing on older rows. */
  prices: WinePricesSchema.nullable().optional(),
  /**
   * CellarTracker's own id for this wine (its `iWine` column), kept from an import so a later
   * export matches this wine even after its name was edited. Missing on most rows.
   */
  cellarTrackerId: z.string().nullable().optional(),
});
export type Wine = z.infer<typeof WineSchema>;

export const LotSchema = z.object({
  ...base,
  wineId: z.string().min(1),
  locationId: text(),
  bin: text(),
  quantity: z.number().int().min(0),
  /** Set when the quantity reaches zero. Closed lots are kept for history (KTD5). */
  closedAt: text(),
  splitFromLotId: text(),
  purchaseDate: IsoDateSchema.nullable().default(null),
  pricePerBottle: z.number().min(0).nullable().default(null),
  currency: CurrencySchema.nullable().default(null),
  store: text(),
  isSample: z.boolean().default(false),
});
export type Lot = z.infer<typeof LotSchema>;

export const LocationSchema = z.object({
  ...base,
  name: z.string().min(1),
  notes: text(),
  isSample: z.boolean().default(false),
});
export type Location = z.infer<typeof LocationSchema>;

export const ConsumptionSchema = z.object({
  ...base,
  wineId: z.string().min(1),
  lotId: text(),
  date: IsoDateSchema,
  quantity: z.number().int().positive(),
  rating: RatingSchema.nullable().default(null),
  occasion: text(),
  isSample: z.boolean().default(false),
});
export type Consumption = z.infer<typeof ConsumptionSchema>;

export const TastingNoteSchema = z.object({
  ...base,
  wineId: z.string().min(1),
  /** Set when the note was written while drinking a bottle (KTD9). */
  consumptionId: text(),
  date: IsoDateSchema,
  text: z.string().min(1),
  rating: RatingSchema.nullable().default(null),
  isSample: z.boolean().default(false),
});
export type TastingNote = z.infer<typeof TastingNoteSchema>;

export const WishlistItemSchema = z.object({
  ...base,
  producer: z.string().min(1),
  name: z.string().default(""),
  vintage: YearSchema.nullable().default(null),
  colour: ColourSchema.nullable().default(null),
  country: text(),
  region: text(),
  notes: text(),
  /** Price the collector hopes to pay per bottle. */
  targetPrice: z.number().min(0).nullable().default(null),
  currency: text(),
  isSample: z.boolean().default(false),
});
export type WishlistItem = z.infer<typeof WishlistItemSchema>;

export const TABLE_NAMES = [
  "wines",
  "lots",
  "consumptions",
  "tastingNotes",
  "locations",
  "wishlist",
] as const;
/** Tables whose rows are cellar records that commands change and undo can restore. */
export type RecordTableName = (typeof TABLE_NAMES)[number];

/** One record change inside an event batch. `before` null = created, `after` null = removed. */
export const ChangeSchema = z.object({
  table: z.enum(TABLE_NAMES),
  id: z.string().min(1),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type Change = z.infer<typeof ChangeSchema>;

/**
 * One user-visible change (a command run). Undo restores every `before` image when each touched
 * record still matches its `after` image's `updatedAt` (KTD7).
 */
export const EventBatchSchema = z.object({
  ...base,
  source: EventSourceSchema,
  /** Command name, for example "consumeBottles". */
  command: z.string().min(1),
  /** Plain-language summary, for example "Drank 1 bottle of Ridge Monte Bello 2019". */
  summary: z.string(),
  changes: z.array(ChangeSchema).default([]),
  undoneAt: text(),
  /** For restore and wipe: the safety snapshot that undo brings back. */
  snapshotId: text(),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

export const ChatThreadSchema = z.object({
  ...base,
  title: z.string().default(""),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

export const ChatMessageSchema = z.object({
  ...base,
  threadId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  /** Message text or content blocks, as stored by the sommelier. */
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  /** Extra state the sommelier keeps with a message (proposal status and so on). */
  meta: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AiUsageSchema = z.object({
  ...base,
  /** Feature name, for example "scan", "describe", "window", "note", "csv", "chat". */
  feature: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheWriteTokens: z.number().int().min(0).default(0),
  /** Null when the served model has no known price. */
  costUsd: z.number().min(0).nullable(),
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

export const SettingRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
export type SettingRow = z.infer<typeof SettingRowSchema>;
