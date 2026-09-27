import { z } from "zod";
import { db } from "../../db/db";
import { newId } from "../../lib/id";
import { nowIso } from "../clock";
import type { ChangeSet } from "../events";
import { bottles, wineLabel } from "../labels";
import { isMatchCandidate, wineKey } from "../match";
import { LotSchema, WineSchema, type EventSource, type Wine, type WindowSource } from "../types";
import {
  cleanPatch,
  cleanText,
  CommandError,
  defineCommand,
  notFound,
  type CommandContext,
} from "./core";
import {
  WineDraftSchema,
  WineFieldsSchema,
  WineValueFieldsSchema,
  type WineDraft,
} from "./schemas";
import { pluralize } from "../../lib/format";

type ParsedDraft = z.output<typeof WineDraftSchema>;

function defaultWindowSource(source: EventSource): WindowSource {
  if (source === "import") return "import";
  if (source.startsWith("ai-")) return "ai";
  return "user";
}

function checkWindow(from: number | null | undefined, to: number | null | undefined) {
  if (from != null && to != null && to < from) {
    throw new CommandError("The drinking window ends before it starts.", "invalid-input");
  }
}

/** Index of wines a draft may attach to, keyed by the matcher key (KTD6). */
async function buildWineIndex(): Promise<Map<string, Wine>> {
  const index = new Map<string, Wine>();
  for (const wine of await db.wines.toArray()) {
    if (isMatchCandidate(wine) && !index.has(wineKey(wine))) index.set(wineKey(wine), wine);
  }
  return index;
}

export interface AddDraftsOutcome {
  bottleCount: number;
  wines: Wine[];
}

/**
 * Adds drafts inside a command: each draft attaches to `wineId` (unless it is a sample wine),
 * else to a matching wine, else creates a new wine; then each lot draft becomes a lot.
 */
export async function addDrafts(
  changes: ChangeSet,
  drafts: ParsedDraft[],
  source: EventSource,
): Promise<AddDraftsOutcome> {
  const index = await buildWineIndex();
  const locationIds = new Set(await db.locations.toCollection().primaryKeys());
  const wines = new Map<string, Wine>();
  let bottleCount = 0;

  for (const draft of drafts) {
    checkWindow(draft.windowFrom, draft.windowTo);
    let wine: Wine | undefined;
    if (draft.wineId) {
      wine = await changes.get("wines", draft.wineId);
      if (!wine || wine.deletedAt) throw notFound("wine");
      // Real bottles never attach to a sample wine (clearing samples would remove them), so treat
      // the draft like one without a wineId: match a real wine, else create one.
      if (wine.isSample) wine = index.get(wineKey(draft));
    } else {
      wine = index.get(wineKey(draft));
    }
    if (!wine) {
      const t = nowIso();
      const hasWindow = draft.windowFrom != null || draft.windowTo != null;
      wine = WineSchema.parse({
        id: newId(),
        createdAt: t,
        updatedAt: t,
        producer: draft.producer,
        name: draft.name ?? "",
        vintage: draft.vintage,
        colour: draft.colour,
        country: cleanText(draft.country),
        region: cleanText(draft.region),
        appellation: cleanText(draft.appellation),
        grapes: (draft.grapes ?? []).map((g) => g.trim()).filter(Boolean),
        bottleSize: draft.bottleSize,
        windowFrom: draft.windowFrom ?? null,
        windowTo: draft.windowTo ?? null,
        windowSource: hasWindow ? (draft.windowSource ?? defaultWindowSource(source)) : null,
        windowNote: cleanText(draft.windowNote),
        thumbnail: draft.thumbnail ?? null,
        rating: draft.rating ?? null,
        tags: draft.tags ?? [],
        notes: cleanText(draft.notes),
      });
      await changes.insert("wines", wine);
      index.set(wineKey(wine), wine);
    }
    wines.set(wine.id, wine);

    for (const lot of draft.lots) {
      if (lot.locationId && !locationIds.has(lot.locationId)) throw notFound("location");
      const t = nowIso();
      await changes.insert(
        "lots",
        LotSchema.parse({
          id: newId(),
          createdAt: t,
          updatedAt: t,
          wineId: wine.id,
          locationId: lot.locationId ?? null,
          bin: cleanText(lot.bin),
          quantity: lot.quantity,
          purchaseDate: lot.purchaseDate ?? null,
          pricePerBottle: lot.pricePerBottle ?? null,
          currency: lot.currency ?? null,
          store: cleanText(lot.store),
        }),
      );
      bottleCount += lot.quantity;
    }
  }
  return { bottleCount, wines: [...wines.values()] };
}

export function addedSummary({ bottleCount, wines }: AddDraftsOutcome): string {
  const [only] = wines;
  if (wines.length === 1 && only) return `Added ${bottles(bottleCount)} of ${wineLabel(only)}`;
  return `Added ${bottles(bottleCount)} of ${pluralize(wines.length, "wine")}`;
}

const AddBottlesInput = z.object({
  drafts: z
    .array(
      WineDraftSchema.extend({
        lots: WineDraftSchema.shape.lots.unwrap().min(1, "needs at least one bottle"),
      }),
    )
    .min(1),
});

export const addBottlesCommand = defineCommand({
  name: "addBottles",
  description:
    "Add bottles of one or more wines. Each draft attaches to an existing wine when producer, cuvée, vintage and bottle size match; otherwise it creates the wine.",
  input: AddBottlesInput,
  async execute(input, changes, { source }) {
    return { summary: addedSummary(await addDrafts(changes, input.drafts, source)) };
  },
});

export const importRowsCommand = defineCommand({
  name: "importRows",
  description: "Bulk add rows from a CSV import in one undoable change.",
  input: z.object({ rows: z.array(WineDraftSchema).min(1) }),
  defaultSource: "import",
  async execute(input, changes, { source }) {
    const outcome = await addDrafts(changes, input.rows, source);
    return {
      summary: `Imported ${pluralize(outcome.wines.length, "wine")} (${bottles(outcome.bottleCount)})`,
    };
  },
});

const WINDOW_FIELDS = ["windowFrom", "windowTo"] as const;
const VALUE_FIELDS = ["valuePerBottle", "valueCurrency"] as const;

/**
 * Applies a value edit to `next`: only the collector may set a value, a value needs a currency,
 * clearing the value clears its currency, and a changed value records when it changed.
 */
function applyValueEdit(wine: Wine, next: Partial<Wine>, source: EventSource) {
  if (!VALUE_FIELDS.some((k) => k in next)) return;
  if (source !== "user") {
    throw new CommandError("Only you can enter what a wine is worth.", "refused");
  }
  const amount = next.valuePerBottle !== undefined ? next.valuePerBottle : wine.valuePerBottle;
  let currency = next.valueCurrency !== undefined ? next.valueCurrency : wine.valueCurrency;
  if (amount == null) currency = null;
  else if (!currency) {
    throw new CommandError("Please choose a currency for the value.", "invalid-input");
  }
  next.valuePerBottle = amount ?? null;
  next.valueCurrency = currency ?? null;
  // Rows saved before values existed have no value fields; treat them as null.
  const changed =
    next.valuePerBottle !== (wine.valuePerBottle ?? null) ||
    next.valueCurrency !== (wine.valueCurrency ?? null);
  if (changed) next.valueUpdatedAt = nowIso();
  else for (const key of VALUE_FIELDS) delete next[key];
}

export const updateWineCommand = defineCommand({
  name: "updateWine",
  description:
    "Edit a wine's details (producer, name, vintage, region, grapes, notes and so on). The collector's own value per bottle can only be changed by the collector.",
  input: z.object({
    wineId: z.string().min(1),
    patch: WineFieldsSchema.partial().extend(WineValueFieldsSchema.shape),
  }),
  async execute({ wineId, patch }, changes, { source }) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    const next = cleanPatch<Wine>(patch);
    applyValueEdit(wine, next, source);
    const windowChanged = WINDOW_FIELDS.some((k) => k in next);
    if (windowChanged) {
      const from = next.windowFrom !== undefined ? next.windowFrom : wine.windowFrom;
      const to = next.windowTo !== undefined ? next.windowTo : wine.windowTo;
      checkWindow(from, to);
      if (patch.windowSource === undefined) {
        next.windowSource = from === null && to === null ? null : "user";
      }
    }
    const updated = await changes.update("wines", wineId, next);
    return { summary: `Edited ${wineLabel(updated)}` };
  },
});

export const deleteWineCommand = defineCommand({
  name: "deleteWine",
  description: "Delete a wine. It moves to Recently deleted for 30 days and can be restored.",
  input: z.object({ wineId: z.string().min(1) }),
  async execute({ wineId }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    await changes.update("wines", wineId, { deletedAt: nowIso() });
    return { summary: `Deleted ${wineLabel(wine)}` };
  },
});

export const restoreWineCommand = defineCommand({
  name: "restoreWine",
  description: "Bring back a wine from Recently deleted.",
  input: z.object({ wineId: z.string().min(1) }),
  async execute({ wineId }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine) throw notFound("wine");
    if (!wine.deletedAt) throw new CommandError("This wine is not deleted.");
    await changes.update("wines", wineId, { deletedAt: null });
    return { summary: `Restored ${wineLabel(wine)}` };
  },
});

export const PURGE_AFTER_DAYS = 30;

export const purgeDeletedCommand = defineCommand({
  name: "purgeDeleted",
  description:
    "Permanently remove wines deleted more than 30 days ago, with their bottles and notes.",
  humanOnly: "Permanently removes records; only the app (on start) or the user may do this.",
  input: z.object({
    olderThanDays: z.number().int().min(0).default(PURGE_AFTER_DAYS),
    /** Remove this one deleted wine now ("Delete forever"), whatever its age. */
    wineId: z.string().min(1).optional(),
  }),
  async execute({ olderThanDays, wineId }, changes) {
    let stale: Wine[];
    if (wineId) {
      const wine = await changes.get("wines", wineId);
      if (!wine) throw notFound("wine");
      if (!wine.deletedAt) throw new CommandError("Only deleted wines can be removed permanently.");
      stale = [wine];
    } else {
      const cutoff = new Date(Date.parse(nowIso()) - olderThanDays * 86_400_000).toISOString();
      stale = (await db.wines.toArray()).filter((w) => w.deletedAt && w.deletedAt < cutoff);
    }
    for (const wine of stale) {
      for (const table of ["lots", "consumptions", "tastingNotes"] as const) {
        const ids = await db.table(table).where("wineId").equals(wine.id).primaryKeys();
        for (const id of ids) await changes.remove(table, String(id));
      }
      await changes.remove("wines", wine.id);
    }
    return { summary: `Permanently removed ${pluralize(stale.length, "deleted wine")}` };
  },
});

export const addBottles = (input: z.input<typeof AddBottlesInput>, ctx?: CommandContext) =>
  addBottlesCommand.run(input, ctx);
export const importRows = (input: { rows: WineDraft[] }, ctx?: CommandContext) =>
  importRowsCommand.run(input, ctx);
export const updateWine = (input: z.input<typeof updateWineCommand.input>, ctx?: CommandContext) =>
  updateWineCommand.run(input, ctx);
export const deleteWine = (input: { wineId: string }, ctx?: CommandContext) =>
  deleteWineCommand.run(input, ctx);
export const restoreWine = (input: { wineId: string }, ctx?: CommandContext) =>
  restoreWineCommand.run(input, ctx);
export const purgeDeleted = (
  input: { olderThanDays?: number; wineId?: string } = {},
  ctx?: CommandContext,
) => purgeDeletedCommand.run(input, ctx);
