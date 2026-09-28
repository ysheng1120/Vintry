import { z } from "zod";
import {
  ColourSchema,
  CurrencySchema,
  IsoDateSchema,
  RatingSchema,
  WindowSourceSchema,
  YearSchema,
} from "../types";

/** Shared input pieces for commands. They double as AI tool schemas, so fields carry descriptions. */

const optionalText = (description: string) =>
  z.string().nullable().optional().describe(description);

export const LotDraftSchema = z.object({
  quantity: z.number().int().min(1).describe("Number of bottles"),
  locationId: z.string().nullable().optional().describe("Location id from list_locations"),
  bin: optionalText("Bin or shelf, free text"),
  purchaseDate: IsoDateSchema.nullable().optional().describe("Purchase date, YYYY-MM-DD"),
  pricePerBottle: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe("Price paid per bottle. Only from the user, never estimated"),
  currency: CurrencySchema.nullable().optional().describe("ISO currency code, for example GBP"),
  store: optionalText("Where it was bought"),
});
export type LotDraft = z.input<typeof LotDraftSchema>;

export const WineFieldsSchema = z.object({
  producer: z.string().trim().min(1).describe("Producer or estate"),
  name: z.string().trim().optional().describe("Cuvée or wine name; empty if none"),
  vintage: YearSchema.nullable().describe("Vintage year, or null for non-vintage"),
  colour: ColourSchema,
  country: optionalText("Country"),
  region: optionalText("Region, for example Bordeaux"),
  appellation: optionalText("Appellation, for example Margaux"),
  grapes: z.array(z.string()).optional().describe("Grape varieties"),
  bottleSize: z.number().int().positive().optional().describe("Bottle size in ml, default 750"),
  windowFrom: YearSchema.nullable().optional().describe("First year of the drinking window"),
  windowTo: YearSchema.nullable().optional().describe("Last year of the drinking window"),
  windowSource: WindowSourceSchema.nullable().optional(),
  windowNote: optionalText("Why this window"),
  thumbnail: optionalText("Label image as a data URL"),
  rating: RatingSchema.nullable().optional().describe("The user's own score out of 100"),
  tags: z.array(z.string()).optional(),
  notes: optionalText("Free notes"),
});
export type WineFields = z.input<typeof WineFieldsSchema>;

export const WineDraftSchema = WineFieldsSchema.extend({
  wineId: z.string().optional().describe("Add to this existing wine instead of matching by name"),
  lots: z.array(LotDraftSchema).default([]),
});
export type WineDraft = z.input<typeof WineDraftSchema>;

/**
 * A draft from a CSV import row. `cellarTrackerId` is CellarTracker's own wine id (its `iWine`
 * column): the row matches the wine that carries it first, and a wine the row creates or joins
 * keeps it. Import only: not an AI tool field, and not something a wine edit changes.
 */
export const ImportDraftSchema = WineDraftSchema.extend({
  cellarTrackerId: z.string().trim().min(1).nullable().optional(),
});
export type ImportDraft = z.input<typeof ImportDraftSchema>;

/**
 * The collector's own market value for a wine. Only `updateWine` takes it, and only from the
 * collector: the command refuses it from AI, import, or any other source.
 */
export const WineValueFieldsSchema = z.object({
  valuePerBottle: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe("The collector's own value per bottle. Only the collector enters this; never set it"),
  valueCurrency: CurrencySchema.nullable()
    .optional()
    .describe("ISO currency code of the collector's value, for example GBP"),
});
export type WineValueFields = z.input<typeof WineValueFieldsSchema>;
