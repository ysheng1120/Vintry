import { snapshotIds } from "../db/backup";
import { db } from "../db/db";
import { getSetting, setSetting, SETTING_KEYS } from "../db/settings";
import { nowIso } from "./clock";
import { scrubChange } from "./events";
import { wineLabel } from "./labels";
import type { EventBatch, Wine } from "./types";

/** History keeps every change from the last 90 days… */
export const HISTORY_KEEP_DAYS = 90;
/** …and always at least the newest 500 changes, however old. */
export const HISTORY_KEEP_AT_LEAST = 500;

const DAY_MS = 86_400_000;

/** `createdAt` of the newest change cleared by `pruneHistory`, or null when none was. */
export async function historyClearedBefore(): Promise<string | null> {
  const value = await getSetting<unknown>(SETTING_KEYS.historyClearedBefore, null);
  return typeof value === "string" ? value : null;
}

/**
 * A restore or erase whose undo still needs it: its safety snapshot is on the device and it is
 * not undone (`takeSnapshot` keeps such snapshots), or its snapshot is still kept at all.
 */
function neededForSnapshot(batch: EventBatch, snapshots: Set<string>): boolean {
  if (!batch.snapshotId) return false;
  return !batch.undoneAt || snapshots.has(batch.snapshotId);
}

/**
 * Retention: clears changes older than HISTORY_KEEP_DAYS from the history, but always keeps the
 * newest HISTORY_KEEP_AT_LEAST, and never a restore or erase that a kept safety snapshot or its
 * own undo still needs. Records when it last cleared (`historyClearedBefore`) so a kept restore
 * or erase older than that is no longer offered for undo: later changes it would have to wait
 * for are gone. Cheap when there is nothing to clear (one count). Returns how many it cleared.
 */
export async function pruneHistory(): Promise<number> {
  return db.transaction("rw", [db.eventBatches, db.settings, db.snapshots], async () => {
    const total = await db.eventBatches.count();
    if (total <= HISTORY_KEEP_AT_LEAST) return 0;
    const cutoff = new Date(Date.parse(nowIso()) - HISTORY_KEEP_DAYS * DAY_MS).toISOString();
    // Oldest first: the old changes that are not among the newest HISTORY_KEEP_AT_LEAST.
    const candidates = await db.eventBatches
      .where("createdAt")
      .below(cutoff)
      .limit(total - HISTORY_KEEP_AT_LEAST)
      .toArray();
    const snapshots = await snapshotIds();
    const stale = candidates.filter((b) => !neededForSnapshot(b, snapshots));
    const newest = stale.at(-1);
    if (!newest) return 0;
    await db.eventBatches.bulkDelete(stale.map((b) => b.id));
    const previous = await historyClearedBefore();
    if (!previous || newest.createdAt > previous) {
      await setSetting(SETTING_KEYS.historyClearedBefore, newest.createdAt);
    }
    return stale.length;
  });
}

type Row = Record<string, unknown>;

/** Every name the wine had in the history: its last row, then each earlier image of it. */
function labelsOf(wine: Wine, batches: EventBatch[]): string[] {
  const labels = new Set([wineLabel(wine)]);
  let state: Row = { ...wine };
  const add = (row: Row) => {
    if (typeof row.producer === "string" && typeof row.name === "string") {
      labels.add(wineLabel(row as unknown as Wine));
    }
  };
  const newestFirst = [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const batch of newestFirst) {
    for (const change of batch.changes) {
      if (change.table !== "wines" || change.id !== wine.id || change.scrubbed) continue;
      if (change.after && !change.fields) add(change.after);
      if (!change.before) continue;
      if (change.fields) {
        state = { ...state };
        for (const field of change.fields) {
          if (change.before[field] === undefined) delete state[field];
          else state[field] = change.before[field];
        }
      } else state = { ...change.before };
      add(state);
    }
  }
  return [...labels].filter(Boolean);
}

/** What a scrubbed summary says in place of the wine's name. */
export const DELETED_WINE_LABEL = "a wine deleted forever";

/**
 * Wipes records deleted forever from the history (run inside the purge's transaction): every
 * change to one of `records` (keys "table:id") keeps only ids (`scrubChange`), and each
 * summary of a batch that touched them names "a wine deleted forever" instead of the wines. Such
 * batches can no longer be undone (`undo.ts`); their ids stay so undo's conflict check for
 * other batches is unchanged.
 */
export async function scrubHistory(records: Set<string>, wines: Wine[]): Promise<void> {
  if (records.size === 0) return;
  const touches = (batch: EventBatch) =>
    batch.changes.some((c) => !c.scrubbed && records.has(`${c.table}:${c.id}`));
  const affected = await db.eventBatches.filter(touches).toArray();
  if (affected.length === 0) return;
  // Longest first, so "… 2019 (1.5 L)" is replaced before "… 2019".
  const labels = wines
    .flatMap((wine) => labelsOf(wine, affected))
    .sort((a, b) => b.length - a.length);
  for (const batch of affected) {
    const summary = labels.reduce(
      (text, label) => text.split(label).join(DELETED_WINE_LABEL),
      batch.summary,
    );
    const changes = batch.changes.map((c) =>
      records.has(`${c.table}:${c.id}`) ? scrubChange(c) : c,
    );
    await db.eventBatches.put({ ...batch, summary, changes, updatedAt: nowIso() });
  }
}
