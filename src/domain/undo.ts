import { hasSnapshot, readSnapshot, replaceTables, snapshotIds } from "../db/backup";
import { BACKUP_TABLES } from "../db/backup-schema";
import { db } from "../db/db";
import { bumpChangesSinceBackup } from "../db/settings";
import { nowIso } from "./clock";
import { referencesOf } from "./events";
import { historyClearedBefore } from "./historyRetention";
import type { Change, EventBatch, RecordTableName } from "./types";

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
export const SCRUBBED_REASON =
  "This change involved a wine that was deleted forever, so it can't be undone.";
export const CLEARED_AFTER_REASON =
  "Some later changes are no longer kept in the history, so this can't be undone.";
const RECORD_GONE = "A record this change touched no longer exists, so it can't be undone.";

/** Batches that remove records for good ("Delete forever" and the 30-day purge) cannot be undone. */
function isPermanent(batch: EventBatch): boolean {
  return batch.command === "purgeDeleted";
}

/**
 * Why `batch` can't be undone whatever later batches did, or null. `snapshotKept` says whether
 * its safety snapshot is still on the device; `clearedBefore` is the newest change cleared from
 * the history (`pruneHistory`): a kept batch older than that has lost later changes that would
 * stand in its way, so it can never be undone.
 */
function fixedReason(
  batch: EventBatch,
  snapshotKept: boolean,
  clearedBefore: string | null,
): string | null {
  if (batch.undoneAt) return ALREADY_UNDONE;
  if (isPermanent(batch)) return PERMANENT;
  if (batch.changes.some((c) => c.scrubbed)) return SCRUBBED_REASON;
  if (batch.snapshotId && !snapshotKept) return SNAPSHOT_GONE;
  if (clearedBefore && batch.createdAt < clearedBefore) return CLEARED_AFTER_REASON;
  return null;
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
  const snapshotKept = batch.snapshotId ? await hasSnapshot(batch.snapshotId) : true;
  const reason = fixedReason(batch, snapshotKept, await historyClearedBefore());
  if (reason) return { batch, result: { ok: false, reason } };
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
  const clearedBefore = await historyClearedBefore();
  for (const { id } of batches) {
    const batch = byId.get(id);
    if (!batch) {
      checks.set(id, { ok: false, reason: MISSING });
      continue;
    }
    const snapshotKept = batch.snapshotId ? snapshots.has(batch.snapshotId) : true;
    const reason = fixedReason(batch, snapshotKept, clearedBefore);
    checks.set(id, reason ? { ok: false, reason } : checkFor(blockerAmong(batch, stored)));
  }
  return checks;
}

/** Thrown inside undo's transaction to roll it back and refuse with a plain reason. */
class UndoRefused extends Error {}

/**
 * Puts one record back as it was before `change`, stamping `updatedAt` with `t`. A whole-row
 * image (older batches, and removals) replaces the row; a compact update restores just its
 * listed fields on the current row, which matches the change's `after` image in every other
 * field because no later, not-undone change touched the record.
 */
async function revert(change: Change, t: string): Promise<void> {
  const table = db.table<Record<string, unknown>, string>(change.table);
  if (change.before === null) {
    await table.delete(change.id);
    return;
  }
  if (!change.fields || change.after === null) {
    await table.put({ ...change.before, updatedAt: t });
    return;
  }
  const current = await table.get(change.id);
  if (!current) throw new UndoRefused(RECORD_GONE);
  const next = { ...current };
  for (const field of change.fields) {
    if (change.before[field] === undefined) delete next[field];
    else next[field] = change.before[field];
  }
  await table.put({ ...next, updatedAt: t });
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
  try {
    return await db.transaction("rw", tables, async (): Promise<UndoResult> => {
      // Check again inside the transaction so a change made meanwhile cannot slip through.
      const again = await check(batchId);
      if (!again.result.ok) return again.result;

      const t = nowIso();
      for (const change of [...batch.changes].reverse()) await revert(change, t);
      await db.eventBatches.update(batch.id, { undoneAt: t, updatedAt: t });
      if (batch.source !== "sample") await bumpChangesSinceBackup();
      return { ok: true, summary: `Undid: ${batch.summary}` };
    });
  } catch (err) {
    if (err instanceof UndoRefused) return { ok: false, reason: err.message };
    throw err;
  }
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
