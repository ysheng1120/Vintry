import { restoreSnapshot } from "../db/backup";
import { db } from "../db/db";
import { bumpChangesSinceBackup } from "../db/settings";
import { nowIso } from "./clock";
import { referencesOf } from "./events";
import type { EventBatch, RecordTableName } from "./types";

export type UndoResult =
  { ok: true; summary: string } | { ok: false; reason: string; blockingBatch?: EventBatch };

export type UndoCheck = { ok: true } | { ok: false; reason: string; blockingBatch?: EventBatch };

const NOUNS: Record<RecordTableName, string> = {
  wines: "wine",
  lots: "lot",
  consumptions: "drink",
  tastingNotes: "tasting note",
  locations: "location",
  wishlist: "wishlist item",
};

const key = (table: string, id: string) => `${table}:${id}`;

/**
 * The most recent later, not-undone batch that stands in the way of undoing `batch` (KTD7, R6):
 * one that touched a record this batch touched, one that points at a record this batch created
 * (undo would remove it), or one that removed a record this batch's restored rows point at.
 */
async function findBlocker(
  batch: EventBatch,
): Promise<{ blocker: EventBatch; table: RecordTableName | null } | null> {
  const later = (await db.eventBatches.where("createdAt").above(batch.createdAt).toArray())
    .filter((b) => b.id !== batch.id && !b.undoneAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (later.length === 0) return null;
  const [newest] = later;
  // A restore or wipe replaced everything; anything done since would be lost.
  if (batch.snapshotId && newest) return { blocker: newest, table: null };

  const touched = new Set(batch.changes.map((c) => key(c.table, c.id)));
  const created = new Set(batch.changes.filter((c) => !c.before).map((c) => key(c.table, c.id)));
  const needed = new Set(
    batch.changes.flatMap((c) => referencesOf(c.before).map(([t, id]) => key(t, id))),
  );

  for (const blocker of later) {
    for (const change of blocker.changes) {
      if (touched.has(key(change.table, change.id))) return { blocker, table: change.table };
      for (const [table, id] of referencesOf(change.after)) {
        if (created.has(key(table, id))) return { blocker, table };
      }
      if (change.after === null && needed.has(key(change.table, change.id))) {
        return { blocker, table: change.table };
      }
    }
  }
  return null;
}

async function check(batchId: string): Promise<{ batch?: EventBatch; result: UndoCheck }> {
  const batch = await db.eventBatches.get(batchId);
  if (!batch) return { result: { ok: false, reason: "This change is no longer in the history." } };
  if (batch.undoneAt) {
    return { batch, result: { ok: false, reason: "This change has already been undone." } };
  }
  const found = await findBlocker(batch);
  if (found) {
    const noun = found.table ? `this ${NOUNS[found.table]}` : "your data";
    return {
      batch,
      result: {
        ok: false,
        reason: `A later change touched ${noun} (${found.blocker.summary}). Undo that first.`,
        blockingBatch: found.blocker,
      },
    };
  }
  return { batch, result: { ok: true } };
}

/** Whether a batch can be undone right now, without changing anything (for History). */
export async function checkUndo(batchId: string): Promise<UndoCheck> {
  return (await check(batchId)).result;
}

/**
 * Undoes one event batch (R6). Allowed only when no later change that is not itself undone
 * stands in the way; restored records get a fresh `updatedAt` and the batch is marked undone.
 * Undoing a restore or wipe brings back its safety snapshot (AE6).
 */
export async function undoBatch(batchId: string): Promise<UndoResult> {
  const first = await check(batchId);
  if (!first.result.ok || !first.batch) return first.result as UndoResult;
  const batch = first.batch;

  if (batch.snapshotId) {
    await restoreSnapshot(batch.snapshotId);
    return { ok: true, summary: `Undid: ${batch.summary}` };
  }

  const tables = [
    db.wines,
    db.lots,
    db.consumptions,
    db.tastingNotes,
    db.locations,
    db.wishlist,
    db.eventBatches,
    db.settings,
  ];
  return db.transaction("rw", tables, async (): Promise<UndoResult> => {
    // Check again inside the transaction so a change made meanwhile cannot slip through.
    const again = await check(batchId);
    if (!again.result.ok) return again.result;

    const t = nowIso();
    for (const change of [...batch.changes].reverse()) {
      const table = db.table(change.table);
      if (change.before === null) await table.delete(change.id);
      else await table.put({ ...change.before, updatedAt: t });
    }
    await db.eventBatches.update(batch.id, { undoneAt: t, updatedAt: t });
    if (batch.source !== "sample") await bumpChangesSinceBackup();
    return { ok: true, summary: `Undid: ${batch.summary}` };
  });
}
