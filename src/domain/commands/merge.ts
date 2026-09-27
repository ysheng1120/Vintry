import { z } from "zod";
import { db } from "../../db/db";
import { nowIso } from "../clock";
import type { ChangeSet } from "../events";
import { wineLabel } from "../labels";
import type { RecordTableName, Wine } from "../types";
import { CommandError, defineCommand, notFound, type CommandContext } from "./core";

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Plain fields copied onto the kept wine, one at a time, only when it has none of its own. */
const FILLABLE_FIELDS = [
  "name",
  "vintage",
  "country",
  "region",
  "appellation",
  "grapes",
  "windowNote",
  "thumbnail",
  "rating",
  "tags",
  "notes",
] as const satisfies readonly (keyof Wine)[];

/**
 * Fields the kept wine takes from the merged one when it has none of its own (never overwriting
 * a field that is already set): plain fields one at a time, then the drinking window and the
 * collector's value as groups, since a lone `windowFrom` or a value with no currency makes no
 * sense on its own.
 */
function fillFromMerged(keep: Wine, merged: Wine): Partial<Wine> {
  const patch: Partial<Wine> = {};
  for (const field of FILLABLE_FIELDS) {
    if (isEmptyValue(keep[field]) && !isEmptyValue(merged[field])) {
      (patch as Record<string, unknown>)[field] = merged[field];
    }
  }
  if (
    isEmptyValue(keep.windowFrom) &&
    isEmptyValue(keep.windowTo) &&
    !(isEmptyValue(merged.windowFrom) && isEmptyValue(merged.windowTo))
  ) {
    patch.windowFrom = merged.windowFrom;
    patch.windowTo = merged.windowTo;
    patch.windowSource = merged.windowSource;
  }
  if (isEmptyValue(keep.valuePerBottle) && !isEmptyValue(merged.valuePerBottle)) {
    patch.valuePerBottle = merged.valuePerBottle;
    patch.valueCurrency = merged.valueCurrency;
    patch.valueUpdatedAt = merged.valueUpdatedAt;
  }
  return patch;
}

const MOVED_TABLES = [
  "lots",
  "consumptions",
  "tastingNotes",
] as const satisfies readonly RecordTableName[];

/** Re-points every row of `table` that belongs to `fromWineId` at `toWineId` (KTD4). */
async function retagWine(
  changes: ChangeSet,
  table: (typeof MOVED_TABLES)[number],
  fromWineId: string,
  toWineId: string,
): Promise<void> {
  const ids = await db.table(table).where("wineId").equals(fromWineId).primaryKeys();
  for (const id of ids) await changes.update(table, String(id), { wineId: toWineId });
}

const MergeInput = z.object({
  keepId: z.string().min(1).describe("The wine that stays"),
  mergeId: z
    .string()
    .min(1)
    .describe("The duplicate wine: its bottles, drinks and notes move over, then it is deleted"),
});

export const mergeWinesCommand = defineCommand({
  name: "mergeWines",
  description:
    "Merge a duplicate wine into another: every bottle, drink and tasting note moves to the kept wine, empty fields on it are filled in from the duplicate, and the duplicate is then deleted.",
  input: MergeInput,
  async execute({ keepId, mergeId }, changes) {
    if (keepId === mergeId) {
      throw new CommandError("Choose two different wines to merge.", "invalid-input");
    }
    const keep = await changes.get("wines", keepId);
    if (!keep || keep.deletedAt) throw notFound("wine");
    const merged = await changes.get("wines", mergeId);
    if (!merged || merged.deletedAt) throw notFound("wine");
    if (keep.isSample !== merged.isSample) {
      throw new CommandError(
        "One of these is sample data and the other is a real wine, so they can't be merged.",
      );
    }

    for (const table of MOVED_TABLES) await retagWine(changes, table, mergeId, keepId);

    const patch = fillFromMerged(keep, merged);
    const kept =
      Object.keys(patch).length > 0 ? await changes.update("wines", keepId, patch) : keep;
    await changes.update("wines", mergeId, { deletedAt: nowIso() });

    return { summary: `Merged 2 wines: ${wineLabel(kept)}` };
  },
});

export const mergeWines = (input: z.input<typeof MergeInput>, ctx?: CommandContext) =>
  mergeWinesCommand.run(input, ctx);
