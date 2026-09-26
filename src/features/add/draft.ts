/**
 * Draft types and helpers for the one confirm card for new bottles (`DraftCard`).
 *
 * Contract (manual add, label scan, describe, wishlist conversion, and sommelier proposals all
 * use it; keep it stable):
 *
 *   <DraftCard drafts={BottleDraft[]} source={EventSource} onSaved={(result) => …} onCancel={() => …} />
 *
 * - `drafts`: one entry per wine. Wine fields are flat (producer, name, vintage, colour, …);
 *   `lots` holds the bottles (quantity, location by id or by name, bin, purchase date, price,
 *   currency, store). Every field is optional except `lots`; the card lets the user fill gaps.
 *   - `vintage`: a year, `null` for non-vintage (NV), or left out when unknown (the user must
 *     then enter one or tick NV).
 *   - `notes`: hints shown above the fields (for example "Price looked like a case price").
 *     The wine's own free-text notes go in `wineNotes`.
 *   - `lowConfidence`: field names to highlight for checking, from `DRAFT_FIELD_NAMES`.
 *   - `priceBasis`: how to read the lot prices. "per-bottle" (default) reads `pricePerBottle`,
 *     "total" reads `totalPrice` (the price for the whole lot), and "unclear" shows a toggle the
 *     user must answer before saving. The toggle converts total ↔ per bottle.
 *   - `wineId`: add the lots to this existing wine. Without it, the card uses the matcher
 *     (`findMatchingWine`) and shows "Add to existing wine: <label>" when one matches.
 *   - Lots without a location use the default: the location used most recently, else the first.
 *     A `locationName` that matches no location is created when the user saves.
 * - `source`: the event source passed to `addBottles` (for example "user", "ai-scan").
 * - `onSaved(result)`: called once after the bottles are saved, with the `addBottles` result
 *   (`result.batchId` for Undo, `result.touched.wineIds` for the wines). The caller shows the
 *   Undo toast and navigates.
 * - `onCancel()`: the user dismissed the card; nothing was written.
 * - `save` (optional): replaces the final `addBottles` call, for flows whose command adds the
 *   bottles as part of a larger change (for example `convertWishlistItem`, which also removes the
 *   wishlist item in the same batch). It receives the finished `addBottles` drafts.
 */
import { db } from "../../db/db";
import type { CommandResult, LotDraft, WineDraft } from "../../domain/commands";
import { normalizeName } from "../../domain/match";
import {
  COLOURS,
  DEFAULT_BOTTLE_SIZE,
  type Colour,
  type EventSource,
  type Location,
  type WindowSource,
  type Wine,
} from "../../domain/types";
import { newId } from "../../lib/id";

export type PriceBasis = "per-bottle" | "total" | "unclear";

export interface BottleLotDraft {
  quantity?: number;
  locationId?: string | null;
  /** A location by name: matched to an existing one (ignoring case), or created on save. */
  locationName?: string | null;
  bin?: string | null;
  /** `YYYY-MM-DD`. */
  purchaseDate?: string | null;
  pricePerBottle?: number | null;
  /** Price for the whole lot; used when `priceBasis` is "total" (or "unclear"). */
  totalPrice?: number | null;
  /** ISO code such as GBP. */
  currency?: string | null;
  store?: string | null;
}

export interface BottleDraft {
  /** Add to this existing wine instead of matching by name. */
  wineId?: string | null;
  producer?: string | null;
  name?: string | null;
  /** A year; null means NV; undefined means unknown. */
  vintage?: number | null;
  colour?: Colour | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
  grapes?: string[] | null;
  /** Millilitres; default 750. */
  bottleSize?: number | null;
  windowFrom?: number | null;
  windowTo?: number | null;
  /** Where a supplied window came from; a window the user types or edits is always "user". */
  windowSource?: WindowSource | null;
  windowNote?: string | null;
  thumbnail?: string | null;
  /** The wine's own free-text notes. */
  wineNotes?: string | null;
  lots: BottleLotDraft[];
  /** Hints shown to the user above the fields. */
  notes?: string[];
  /** Field names (see DRAFT_FIELD_NAMES) to highlight for checking. */
  lowConfidence?: string[];
  priceBasis?: PriceBasis;
}

export interface DraftCardProps {
  drafts: BottleDraft[];
  source: EventSource;
  onSaved: (result: CommandResult) => void;
  onCancel: () => void;
  /** Label for the save button; default "Add N bottles". */
  saveLabel?: string;
  /** Saves the finished drafts instead of `addBottles` (see the contract above). */
  save?: (drafts: (WineDraft & { lots: LotDraft[] })[]) => Promise<CommandResult>;
}

/** Field names that `lowConfidence` may name. */
export const DRAFT_FIELD_NAMES = [
  "producer",
  "name",
  "vintage",
  "colour",
  "country",
  "region",
  "appellation",
  "grapes",
  "bottleSize",
  "windowFrom",
  "windowTo",
  "quantity",
  "location",
  "bin",
  "purchaseDate",
  "price",
  "currency",
  "store",
] as const;

export const BOTTLE_SIZES = [187, 375, 500, 750, 1000, 1500, 3000, 4500, 6000] as const;

export const MIN_YEAR = 1800;
export const MAX_YEAR = 2200;

// ---------- wine form values ----------

/** The wine fields as the form edits them (text inputs hold strings). */
export interface WineFormValues {
  producer: string;
  name: string;
  vintage: string;
  nv: boolean;
  colour: Colour;
  country: string;
  region: string;
  appellation: string;
  /** Comma-separated. */
  grapes: string;
  bottleSize: string;
  windowFrom: string;
  windowTo: string;
  notes: string;
}

export type WineFormErrors = Partial<Record<keyof WineFormValues, string>>;

const str = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export function wineFormValues(fields: {
  producer?: string | null;
  name?: string | null;
  vintage?: number | null;
  colour?: Colour | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
  grapes?: string[] | null;
  bottleSize?: number | null;
  windowFrom?: number | null;
  windowTo?: number | null;
  notes?: string | null;
}): WineFormValues {
  return {
    producer: str(fields.producer),
    name: str(fields.name),
    vintage: str(fields.vintage),
    nv: fields.vintage === null,
    colour: fields.colour && COLOURS.includes(fields.colour) ? fields.colour : "red",
    country: str(fields.country),
    region: str(fields.region),
    appellation: str(fields.appellation),
    grapes: (fields.grapes ?? []).join(", "),
    bottleSize: str(fields.bottleSize ?? DEFAULT_BOTTLE_SIZE),
    windowFrom: str(fields.windowFrom),
    windowTo: str(fields.windowTo),
    notes: str(fields.notes),
  };
}

const isWholeNumber = (text: string) => /^\d+$/.test(text.trim());

/** Parses an optional year field; undefined when blank, NaN when not a whole number. */
function parseYear(text: string): number | undefined {
  if (!text.trim()) return undefined;
  return isWholeNumber(text) ? Number(text.trim()) : Number.NaN;
}

/** Checks the wine fields. `year` is the current year (vintages may be up to next year). */
export function validateWineValues(
  values: WineFormValues,
  year: number,
  { includeWindow = true }: { includeWindow?: boolean } = {},
): WineFormErrors {
  const errors: WineFormErrors = {};
  if (!values.producer.trim()) errors.producer = "Producer is required";

  if (!values.nv) {
    const vintage = parseYear(values.vintage);
    if (vintage === undefined) errors.vintage = "Enter a vintage or tick NV";
    else if (!(vintage >= MIN_YEAR && vintage <= year + 1)) {
      errors.vintage = `Vintage must be a year from ${MIN_YEAR} to ${year + 1}`;
    }
  }

  const size = values.bottleSize.trim();
  if (!isWholeNumber(size) || Number(size) <= 0) errors.bottleSize = "Choose a bottle size";

  if (includeWindow) Object.assign(errors, validateWindowValues(values));
  return errors;
}

export function validateWindowValues(values: {
  windowFrom: string;
  windowTo: string;
}): Pick<WineFormErrors, "windowFrom" | "windowTo"> {
  const errors: Pick<WineFormErrors, "windowFrom" | "windowTo"> = {};
  const from = parseYear(values.windowFrom);
  const to = parseYear(values.windowTo);
  const bad = (y: number | undefined) => y !== undefined && !(y >= MIN_YEAR && y <= MAX_YEAR);
  if (bad(from)) errors.windowFrom = "Enter a year like 2030";
  if (bad(to)) errors.windowTo = "Enter a year like 2035";
  if (!errors.windowFrom && !errors.windowTo && from !== undefined && to !== undefined) {
    if (to < from) errors.windowTo = "Drink to must not be before Drink from";
  }
  return errors;
}

/** Optional year to number or null. Only call on validated values. */
export function yearOrNull(text: string): number | null {
  const year = parseYear(text);
  return year === undefined || Number.isNaN(year) ? null : year;
}

const textOrNull = (text: string) => text.trim() || null;

export function splitGrapes(text: string): string[] {
  return text
    .split(/[,;/]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/** Wine fields for a command, from validated form values (window fields not included). */
export function wineFieldsFromValues(values: WineFormValues) {
  return {
    producer: values.producer.trim(),
    name: values.name.trim(),
    vintage: values.nv ? null : yearOrNull(values.vintage),
    colour: values.colour,
    country: textOrNull(values.country),
    region: textOrNull(values.region),
    appellation: textOrNull(values.appellation),
    grapes: splitGrapes(values.grapes),
    bottleSize: Number(values.bottleSize.trim()) || DEFAULT_BOTTLE_SIZE,
    notes: textOrNull(values.notes),
  };
}

// ---------- prices ----------

/** Parses a typed amount ("24.50", "24,50", "£1,200"); undefined when blank, NaN when invalid. */
export function parseAmount(text: string): number | undefined {
  let cleaned = text.replace(/[^\d.,-]/g, "");
  if (!cleaned) return text.trim() ? Number.NaN : undefined;
  // "1,200.50" → thousands comma; "24,50" → decimal comma.
  if (cleaned.includes(".")) cleaned = cleaned.replace(/,/g, "");
  else if (/,\d{1,2}$/.test(cleaned)) cleaned = cleaned.replace(",", ".");
  else cleaned = cleaned.replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Formats a number for a price input: no trailing zeros beyond cents. */
export function amountText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(round2(value));
}

/**
 * Converts a typed price when the basis toggle changes. From "unclear" nothing is converted: the
 * user is saying what the number already meant.
 */
export function convertPriceText(
  text: string,
  from: PriceBasis,
  to: PriceBasis,
  quantity: number,
): string {
  const amount = parseAmount(text);
  if (amount === undefined || Number.isNaN(amount) || from === to || from === "unclear") {
    return text;
  }
  if (to === "total" && from === "per-bottle") return amountText(amount * quantity);
  if (to === "per-bottle" && from === "total" && quantity > 0) {
    return amountText(amount / quantity);
  }
  return text;
}

/** Price per bottle from a typed amount and its basis. Only call on validated values. */
export function pricePerBottle(text: string, basis: PriceBasis, quantity: number): number | null {
  const amount = parseAmount(text);
  if (amount === undefined || Number.isNaN(amount)) return null;
  return basis === "total" && quantity > 0 ? round2(amount / quantity) : amount;
}

// ---------- lot form values ----------

/** Special values of the location select. */
export const NO_LOCATION = "";
export const NEW_LOCATION = "__new__";

export interface LotFormValues {
  key: string;
  quantity: number;
  /**
   * A location id, NO_LOCATION, NEW_LOCATION (then `newLocationName` holds the name), or
   * null while the default location applies.
   */
  location: string | null;
  newLocationName: string;
  bin: string;
  purchaseDate: string;
  price: string;
  currency: string;
  store: string;
}

export type LotFormErrors = Partial<
  Record<"quantity" | "location" | "price" | "currency" | "purchaseDate", string>
>;

export function lotFormValues(
  lot: BottleLotDraft,
  basis: PriceBasis,
  defaultCurrency: string,
): LotFormValues {
  const amount =
    basis === "per-bottle"
      ? (lot.pricePerBottle ?? null)
      : (lot.totalPrice ??
        (lot.pricePerBottle != null && basis === "total"
          ? lot.pricePerBottle * (lot.quantity ?? 1)
          : (lot.pricePerBottle ?? null)));
  let location: string | null = null;
  let newLocationName = "";
  if (lot.locationId) location = lot.locationId;
  else if (lot.locationName?.trim()) {
    location = NEW_LOCATION;
    newLocationName = lot.locationName.trim();
  }
  return {
    key: newId(),
    quantity: Math.max(1, Math.floor(lot.quantity ?? 1)),
    location,
    newLocationName,
    bin: str(lot.bin),
    purchaseDate: str(lot.purchaseDate),
    price: amountText(amount),
    currency: (lot.currency ?? defaultCurrency).toUpperCase(),
    store: str(lot.store),
  };
}

/**
 * The location a lot will be saved to: an existing id, a name to create, or none.
 * A new name that matches an existing location (ignoring case) uses that location.
 */
export type ResolvedLocation =
  { kind: "id"; id: string } | { kind: "new"; name: string } | { kind: "none" };

export function resolveLotLocation(
  lot: Pick<LotFormValues, "location" | "newLocationName">,
  locations: Location[],
  defaultLocationId: string | null,
): ResolvedLocation {
  const choice = lot.location ?? defaultLocationId ?? NO_LOCATION;
  if (choice === NEW_LOCATION) {
    const name = lot.newLocationName.trim().replace(/\s+/g, " ");
    const existing = locations.find((l) => normalizeName(l.name) === normalizeName(name));
    if (existing) return { kind: "id", id: existing.id };
    return { kind: "new", name };
  }
  if (choice === NO_LOCATION) return { kind: "none" };
  return locations.some((l) => l.id === choice) ? { kind: "id", id: choice } : { kind: "none" };
}

/** The value the location select shows for a lot (a new name matching a location selects it). */
export function lotLocationSelectValue(
  lot: Pick<LotFormValues, "location" | "newLocationName">,
  locations: Location[],
  defaultLocationId: string | null,
): string {
  const resolved = resolveLotLocation(lot, locations, defaultLocationId);
  if (resolved.kind === "id") return resolved.id;
  if (resolved.kind === "new") return NEW_LOCATION;
  return lot.location === NEW_LOCATION ? NEW_LOCATION : NO_LOCATION;
}

export function validateLotValues(lot: LotFormValues, basis: PriceBasis): LotFormErrors {
  const errors: LotFormErrors = {};
  if (!Number.isInteger(lot.quantity) || lot.quantity < 1) errors.quantity = "At least 1 bottle";
  if (lot.location === NEW_LOCATION && !lot.newLocationName.trim()) {
    errors.location = "Name the new location";
  }
  const amount = parseAmount(lot.price);
  if (amount !== undefined) {
    if (Number.isNaN(amount)) errors.price = "Enter a price like 24.50";
    else if (basis === "unclear") {
      errors.price = "Choose Per bottle or For all bottles above.";
    }
    if (!/^[A-Za-z]{3}$/.test(lot.currency.trim())) {
      errors.currency = "Use a three-letter code like GBP";
    }
  }
  if (lot.purchaseDate && !isValidIsoDate(lot.purchaseDate)) {
    errors.purchaseDate = "Enter a date like 2026-09-26";
  }
  return errors;
}

export function isValidIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

// ---------- whole draft ----------

export interface DraftFormState {
  key: string;
  wineId: string | null;
  wine: WineFormValues;
  lots: LotFormValues[];
  priceBasis: PriceBasis;
  hints: string[];
  lowConfidence: string[];
  /** The window as supplied, so an unchanged AI window keeps its source. */
  initialWindow: { from: string; to: string; source: WindowSource | null; note: string | null };
  thumbnail: string | null;
}

export function draftFormState(draft: BottleDraft, defaultCurrency: string): DraftFormState {
  const priceBasis =
    draft.priceBasis ??
    (draft.lots.some((l) => l.totalPrice != null && l.pricePerBottle == null)
      ? "total"
      : "per-bottle");
  const wine = wineFormValues({ ...draft, notes: draft.wineNotes ?? null });
  return {
    key: newId(),
    wineId: draft.wineId ?? null,
    wine,
    lots: (draft.lots.length ? draft.lots : [{ quantity: 1 }]).map((lot) =>
      lotFormValues(lot, priceBasis, defaultCurrency),
    ),
    priceBasis,
    hints: draft.notes ?? [],
    lowConfidence: draft.lowConfidence ?? [],
    initialWindow: {
      from: wine.windowFrom,
      to: wine.windowTo,
      source: draft.windowSource ?? null,
      note: draft.windowNote ?? null,
    },
    thumbnail: draft.thumbnail ?? null,
  };
}

export interface DraftFormErrors {
  wine: WineFormErrors;
  lots: LotFormErrors[];
}

export function validateDraftForm(
  form: DraftFormState,
  year: number,
  { attached = false }: { attached?: boolean } = {},
): DraftFormErrors {
  return {
    // Wine fields are not used when the lots join a wine chosen by id.
    wine: attached ? {} : validateWineValues(form.wine, year),
    lots: form.lots.map((lot) => validateLotValues(lot, form.priceBasis)),
  };
}

export function hasErrors(errors: DraftFormErrors): boolean {
  return Object.keys(errors.wine).length > 0 || errors.lots.some((e) => Object.keys(e).length > 0);
}

/**
 * The `addBottles` draft for a validated form. `locationIdFor` maps a resolved location to its
 * id (new locations have been created by then). For a form attached by `wineId`, pass that wine
 * as `attachedTo`: its identity fills the draft (the command keeps the wine as it is).
 */
export function toWineDraft(
  form: DraftFormState,
  locationIdFor: (lot: LotFormValues) => string | null,
  attachedTo?: Pick<Wine, "producer" | "name" | "vintage" | "colour" | "bottleSize">,
): WineDraft & { lots: LotDraft[] } {
  const lots = form.lots.map((lot): LotDraft => {
    const price = pricePerBottle(lot.price, form.priceBasis, lot.quantity);
    return {
      quantity: lot.quantity,
      locationId: locationIdFor(lot),
      bin: textOrNull(lot.bin),
      purchaseDate: lot.purchaseDate || null,
      pricePerBottle: price,
      currency: price === null ? null : lot.currency.trim().toUpperCase(),
      store: textOrNull(lot.store),
    };
  });
  if (form.wineId && attachedTo) {
    const { producer, name, vintage, colour, bottleSize } = attachedTo;
    return { wineId: form.wineId, producer, name, vintage, colour, bottleSize, lots };
  }
  const fields = wineFieldsFromValues(form.wine);
  const windowFrom = yearOrNull(form.wine.windowFrom);
  const windowTo = yearOrNull(form.wine.windowTo);
  const initial = form.initialWindow;
  const windowUnchanged =
    form.wine.windowFrom === initial.from && form.wine.windowTo === initial.to;
  const hasWindow = windowFrom !== null || windowTo !== null;
  return {
    ...fields,
    ...(form.wineId ? { wineId: form.wineId } : {}),
    windowFrom,
    windowTo,
    windowSource: hasWindow ? (windowUnchanged && initial.source ? initial.source : "user") : null,
    windowNote: hasWindow && windowUnchanged ? initial.note : null,
    thumbnail: form.thumbnail,
    lots,
  };
}

export function totalBottles(forms: DraftFormState[]): number {
  return forms.reduce((sum, f) => sum + f.lots.reduce((s, l) => s + l.quantity, 0), 0);
}

// ---------- defaults ----------

/**
 * The location a new lot goes to by default: the one used most recently for the user's own
 * bottles, else the first location by name, else none.
 */
export async function defaultLocationId(): Promise<string | null> {
  const locations = await db.locations.toArray();
  if (locations.length === 0) return null;
  const ids = new Set(locations.map((l) => l.id));
  const recent = (await db.lots.orderBy("createdAt").reverse().toArray()).find(
    (lot) => !lot.isSample && lot.locationId && ids.has(lot.locationId),
  );
  if (recent?.locationId) return recent.locationId;
  const [first] = [...locations].sort((a, b) => a.name.localeCompare(b.name));
  return first?.id ?? null;
}
