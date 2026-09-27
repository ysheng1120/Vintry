import { hasSnapshot, readSnapshot, replaceTables, snapshotIds } from "../db/backup";
import { BACKUP_TABLES } from "../db/backup-schema";
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

const MISSING = "This change is no longer in the history.";
const ALREADY_UNDONE = "This change has already been undone.";
const PERMANENT = "Wines deleted forever can't be brought back.";
const SNAPSHOT_GONE = "The safety copy for this change is no longer available.";

/** Batches that remove records for good ("Delete forever" and the 30-day purge) cannot be undone. */
function isPermanent(batch: EventBatch): boolean {
  return batch.command === "purgeDeleted";
}

/**
 * The most recent later, not-undone batch that stands in the way of undoing `batch` (KTD7, R6):
 * one that touched a record this batch touched, one that points at a record this batch created
 * (undo would remove it), or one that removed a record this batch's restored rows point at.
 */
async function findBlocker(batch: EventBatch): Promise<Blocker | null> {
  const later = await db.eventBatches.where("createdAt").above(batch.createdAt).toArray();
  return blockerAmong(batch, later);
}

type Blocker = { blocker: EventBatch; table: RecordTableName | null };

const newestFirst = (a: EventBatch, b: EventBatch) => b.createdAt.localeCompare(a.createdAt);

/** The blocker for `batch` among `candidates`, which must include every batch created after it. */
function blockerAmong(batch: EventBatch, candidates: EventBatch[]): Blocker | null {
  const later = candidates
    .filter((b) => b.createdAt > batch.createdAt && b.id !== batch.id && !b.undoneAt)
    .sort(newestFirst);
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
  if (!batch) return { result: { ok: false, reason: MISSING } };
  if (batch.undoneAt) {
    return { batch, result: { ok: false, reason: ALREADY_UNDONE } };
  }
  if (isPermanent(batch)) return { batch, result: { ok: false, reason: PERMANENT } };
  if (batch.snapshotId && !(await hasSnapshot(batch.snapshotId))) {
    return { batch, result: { ok: false, reason: SNAPSHOT_GONE } };
  }
  return { batch, result: checkFor(await findBlocker(batch)) };
}

function checkFor(found: Blocker | null): UndoCheck {
  if (!found) return { ok: true };
  const noun = found.table ? `this ${NOUNS[found.table]}` : "your data";
  return {
    ok: false,
    reason: `A later change touched ${noun} (${found.blocker.summary}). Undo that first.`,
    blockingBatch: found.blocker,
  };
}

/** Whether a batch can be undone right now, without changing anything (for History). */
export async function checkUndo(batchId: string): Promise<UndoCheck> {
  return (await check(batchId)).result;
}

/**
 * `checkUndo` for many batches at once (History's list), keyed by batch id. Reads the stored
 * batches from the oldest given one onwards in one query, then checks each in memory, so every
 * answer matches `checkUndo` for that batch.
 */
export async function checkUndoAll(batches: EventBatch[]): Promise<Map<string, UndoCheck>> {
  const checks = new Map<string, UndoCheck>();
  if (batches.length === 0) return checks;
  // Every given batch, as stored now, and every batch created after any of them.
  const oldest = batches.map((b) => b.createdAt).sort()[0] ?? "";
  const stored = await db.eventBatches.where("createdAt").aboveOrEqual(oldest).toArray();
  const byId = new Map(stored.map((b) => [b.id, b]));
  const snapshots = stored.some((b) => b.snapshotId) ? await snapshotIds() : new Set<string>();
  for (const { id } of batches) {
    const batch = byId.get(id);
    if (!batch) checks.set(id, { ok: false, reason: MISSING });
    else if (batch.undoneAt) checks.set(id, { ok: false, reason: ALREADY_UNDONE });
    else if (isPermanent(batch)) checks.set(id, { ok: false, reason: PERMANENT });
    else if (batch.snapshotId && !snapshots.has(batch.snapshotId)) {
      checks.set(id, { ok: false, reason: SNAPSHOT_GONE });
    } else checks.set(id, checkFor(blockerAmong(batch, stored)));
  }
  return checks;
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

  if (batch.snapshotId) return undoReplaceAll(batch, batch.snapshotId);

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

/**
 * Undoes a restore or erase by bringing back the safety snapshot taken just before it (AE6).
 * The batch itself goes back into the restored history marked undone, so it no longer blocks an
 * earlier restore or erase from being undone in turn. No new snapshot is taken: undo runs only
 * when nothing was changed since, and an extra copy would push out older ones still needed.
 */
async function undoReplaceAll(batch: EventBatch, snapshotId: string): Promise<UndoResult> {
  const snapshot = await readSnapshot(snapshotId);
  if (!snapshot.ok) return { ok: false, reason: SNAPSHOT_GONE };

  return db.transaction("rw", [...BACKUP_TABLES, "snapshots"], async (): Promise<UndoResult> => {
    // Check again inside the write so a change made meanwhile is never silently replaced.
    const again = await check(batch.id);
    if (!again.result.ok) return again.result;

    await replaceTables(snapshot.data);
    const t = nowIso();
    await db.eventBatches.put({ ...batch, undoneAt: t, updatedAt: t });
    return { ok: true, summary: `Undid: ${batch.summary}` };
  });
}
