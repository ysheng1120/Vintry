import { z } from "zod";
import { db } from "../../db/db";
import { newId } from "../../lib/id";
import { nowIso } from "../clock";
import type { ChangeSet } from "../events";
import { bottles, wineLabel } from "../labels";
import { buildWineMatcher, normalizeName } from "../match";
import { scrubHistory } from "../historyRetention";
import { LotSchema, WineSchema, type EventSource, type RecordTableName, type Wine } from "../types";
import { allowedWindowSource } from "../window";
import {
  cleanPatch,
  cleanText,
  CommandError,
  defineCommand,
  notFound,
  type CommandContext,
} from "./core";
import {
  ImportDraftSchema,
  WineDraftSchema,
  WineFieldsSchema,
  WineValueFieldsSchema,
} from "./schemas";
import { pluralize } from "../../lib/format";

type ParsedDraft = z.output<typeof WineDraftSchema> & { cellarTrackerId?: string | null };

function checkWindow(from: number | null | undefined, to: number | null | undefined) {
  if (from != null && to != null && to < from) {
    throw new CommandError("The drinking window ends before it starts.", "invalid-input");
  }
}

export interface AddDraftsOutcome {
  bottleCount: number;
  wines: Wine[];
}

/**
 * Adds drafts inside a command: each draft attaches to `wineId` (unless it is a sample wine),
 * else to a matching wine (by CellarTracker id, then by name; see `buildWineMatcher`), else
 * creates a new wine; then each lot draft becomes a lot. A draft's CellarTracker id is kept on
 * a wine it creates, or on the wine it joins when that wine has none yet.
 */
export async function addDrafts(
  changes: ChangeSet,
  drafts: ParsedDraft[],
  source: EventSource,
): Promise<AddDraftsOutcome> {
  const matcher = buildWineMatcher(await db.wines.toArray());
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
      if (wine.isSample) wine = matcher.find(draft);
    } else {
      wine = matcher.find(draft);
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
        windowSource: hasWindow ? allowedWindowSource(source, draft.windowSource) : null,
        windowNote: cleanText(draft.windowNote),
        thumbnail: draft.thumbnail ?? null,
        rating: draft.rating ?? null,
        tags: draft.tags ?? [],
        notes: cleanText(draft.notes),
        ...(draft.cellarTrackerId ? { cellarTrackerId: draft.cellarTrackerId } : {}),
      });
      await changes.insert("wines", wine);
      matcher.add(wine);
    } else if (draft.cellarTrackerId && !wine.cellarTrackerId) {
      wine = await changes.update("wines", wine.id, { cellarTrackerId: draft.cellarTrackerId });
      matcher.add(wine);
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

const ImportRowsInput = z.object({
  rows: z.array(ImportDraftSchema).min(1),
  /**
   * Locations named in the file that Vintry does not have yet, with the ids the rows' lots use
   * for them. They are created in the same undoable change as the bottles.
   */
  newLocations: z
    .array(z.object({ id: z.string().min(1), name: z.string() }))
    .optional()
    .default([]),
});

export const importRowsCommand = defineCommand({
  name: "importRows",
  description: "Bulk add rows from a CSV import in one undoable change.",
  input: ImportRowsInput,
  defaultSource: "import",
  async execute(input, changes, { source }) {
    // A name that already exists (for example after a retry) reuses that location instead.
    const existing = new Map(
      (await db.locations.toArray()).map((l) => [normalizeName(l.name), l.id]),
    );
    const idFor = new Map<string, string>();
    for (const location of input.newLocations) {
      const name = location.name.trim().replace(/\s+/g, " ");
      if (!name) throw new CommandError("A location needs a name.", "invalid-input");
      const key = normalizeName(name);
      const known = existing.get(key);
      if (known) {
        idFor.set(location.id, known);
        continue;
      }
      const t = nowIso();
      await changes.insert("locations", {
        id: location.id,
        createdAt: t,
        updatedAt: t,
        name,
        notes: null,
        isSample: false,
      });
      existing.set(key, location.id);
      idFor.set(location.id, location.id);
    }
    const rows = input.rows.map((row) => ({
      ...row,
      lots: row.lots.map((lot) =>
        lot.locationId && idFor.has(lot.locationId)
          ? { ...lot, locationId: idFor.get(lot.locationId)! }
          : lot,
      ),
    }));
    const outcome = await addDrafts(changes, rows, source);
    const created = [...idFor.entries()].filter(([from, to]) => from === to).length;
    return {
      summary:
        `Imported ${pluralize(outcome.wines.length, "wine")} (${bottles(outcome.bottleCount)})` +
        (created > 0 ? ` and created ${pluralize(created, "location")}` : ""),
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
      // Only the collector's own edit records "user": an AI edit is always "ai", so AI never
      // passes its estimate off as the collector's.
      next.windowSource =
        from === null && to === null ? null : allowedWindowSource(source, patch.windowSource);
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
    // Every removed record, so no copy of it stays in the history (or in backups made later).
    const removed = new Set<string>();
    const forget = async (table: RecordTableName, id: string) => {
      await changes.remove(table, id);
      changes.forget(table, id);
      removed.add(`${table}:${id}`);
    };
    for (const wine of stale) {
      for (const table of ["lots", "consumptions", "tastingNotes"] as const) {
        const ids = await db.table(table).where("wineId").equals(wine.id).primaryKeys();
        for (const id of ids) await forget(table, String(id));
      }
      await forget("wines", wine.id);
    }
    await scrubHistory(removed, stale);
    return { summary: `Permanently removed ${pluralize(stale.length, "deleted wine")}` };
  },
});

export const addBottles = (input: z.input<typeof AddBottlesInput>, ctx?: CommandContext) =>
  addBottlesCommand.run(input, ctx);
export const importRows = (input: z.input<typeof ImportRowsInput>, ctx?: CommandContext) =>
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
