import type { z } from "zod";
import { nowIso } from "../domain/clock";
import type { EventBatch } from "../domain/types";
import { formatDate, toIsoDate } from "../lib/format";
import { newId } from "../lib/id";
import {
  BACKUP_TABLE_SCHEMAS,
  BACKUP_TABLES,
  type BackupData,
  type BackupFile,
  DEVICE_ONLY_SETTING_KEYS,
} from "./backup-schema";
import { db } from "./db";
import { CURRENT_SCHEMA_VERSION, latestVersion, migrateBackupData, type Row } from "./migrations";
import { SCHEMA_VERSIONS, type SchemaVersion } from "./migrations";
import { setSetting, SETTING_KEYS } from "./settings";

export type { BackupFile } from "./backup-schema";

export const NOT_VINTRY_MESSAGE = "This is not a Vintry backup.";
export const NEWER_VERSION_MESSAGE =
  "This backup was made by a newer Vintry. Update the app first.";

/** How many safety snapshots stay on the device. */
export const SNAPSHOTS_KEPT = 3;

/** Tables a backup must contain for a restore: the cellar records themselves. */
export const REQUIRED_TABLES = [
  "wines",
  "lots",
  "consumptions",
  "tastingNotes",
  "locations",
] as const satisfies readonly (typeof BACKUP_TABLES)[number][];

/** Wines (not deleted) and bottles in a backup, shown before a restore replaces the data. */
export function backupCounts(backup: BackupFile): { wines: number; bottles: number } {
  const wineIds = new Set(backup.data.wines.filter((w) => !w.deletedAt).map((w) => w.id));
  const bottles = backup.data.lots
    .filter((lot) => wineIds.has(lot.wineId))
    .reduce((sum, lot) => sum + lot.quantity, 0);
  return { wines: wineIds.size, bottles };
}

export type ParseBackupResult = { ok: true; backup: BackupFile } | { ok: false; message: string };

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  reason: string;
  wineCount: number;
  bottleCount: number;
}

/** Reads every backed-up table into the backup format (KTD15). Device-only settings stay out. */
export async function exportBackup(): Promise<BackupFile> {
  return db.transaction("r", BACKUP_TABLES, async () => {
    const [
      wines,
      lots,
      consumptions,
      tastingNotes,
      locations,
      wishlist,
      eventBatches,
      chatThreads,
      chatMessages,
      settings,
    ] = await Promise.all([
      db.wines.toArray(),
      db.lots.toArray(),
      db.consumptions.toArray(),
      db.tastingNotes.toArray(),
      db.locations.toArray(),
      db.wishlist.toArray(),
      db.eventBatches.orderBy("createdAt").toArray(),
      db.chatThreads.toArray(),
      db.chatMessages.toArray(),
      db.settings.toArray(),
    ]);
    return {
      app: "vintry" as const,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: nowIso(),
      data: {
        wines,
        lots,
        consumptions,
        tastingNotes,
        locations,
        wishlist,
        eventBatches,
        chatThreads,
        chatMessages,
        settings: settings.filter((row) => !DEVICE_ONLY_SETTING_KEYS.includes(row.key)),
      },
    };
  });
}

/** Suggested download name, for example "vintry-backup-2026-09-26.json". */
export function backupFileName(date: Date = new Date()): string {
  return `vintry-backup-${toIsoDate(date)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeIssue(table: string, index: number, issue: z.core.$ZodIssue): string {
  const field = issue.path.map(String).join(".") || "(row)";
  const where = `${table}, row ${index + 1}`;
  if (issue.message === "missing") {
    return `This backup is damaged: ${where} is missing "${field}".`;
  }
  return `This backup is damaged: ${where} has an invalid "${field}" (${issue.message}).`;
}

/**
 * Validates an untrusted backup (object or JSON text), migrating older schema versions.
 * Never throws; the message is ready to show to the user.
 */
export function parseBackup(
  json: unknown,
  versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
): ParseBackupResult {
  let input = json;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, message: NOT_VINTRY_MESSAGE };
    }
  }
  if (!isRecord(input) || input.app !== "vintry") return { ok: false, message: NOT_VINTRY_MESSAGE };
  const { schemaVersion, data } = input;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, message: NOT_VINTRY_MESSAGE };
  }
  const targetVersion = latestVersion(versions);
  if (schemaVersion > targetVersion) return { ok: false, message: NEWER_VERSION_MESSAGE };
  if (data !== undefined && !isRecord(data)) return { ok: false, message: NOT_VINTRY_MESSAGE };

  // Every export writes every table. A file without the cellar's own tables is cut short or
  // hand-made, and restoring it would silently empty the cellar, so it is refused.
  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(data?.[table])) {
      return { ok: false, message: `This backup is damaged: it has no "${table}" list.` };
    }
  }

  const rawTables: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    const rows = data?.[table] ?? [];
    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      return { ok: false, message: `This backup is damaged: "${table}" is not a list of records.` };
    }
    rawTables[table] = rows;
  }
  const migrated = migrateBackupData(rawTables, schemaVersion, versions);

  const parsed: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const schema = BACKUP_TABLE_SCHEMAS[table];
    const rows = migrated[table] ?? [];
    const out: unknown[] = [];
    for (const [index, row] of rows.entries()) {
      const result = schema.safeParse(row, {
        error: (issue) => (issue.input === undefined ? "missing" : undefined),
      });
      if (!result.success) {
        const issue = result.error.issues[0];
        return {
          ok: false,
          message: issue
            ? describeIssue(table, index, issue)
            : `This backup is damaged: ${table}, row ${index + 1}.`,
        };
      }
      out.push(result.data);
    }
    parsed[table] = out;
  }

  const exportedAt = typeof input.exportedAt === "string" ? input.exportedAt : nowIso();
  return {
    ok: true,
    backup: {
      app: "vintry",
      schemaVersion: targetVersion,
      exportedAt,
      data: parsed as BackupData,
    },
  };
}

/**
 * Stores a full copy of the current data on this device and prunes to the last 3. A snapshot
 * that a not-undone restore or erase in the history still points at is never pruned, since
 * undoing that change needs it.
 */
export async function takeSnapshot(reason: string): Promise<string> {
  const backup = await exportBackup();
  const id = newId();
  await db.transaction("rw", db.snapshots, db.eventBatches, async () => {
    await db.snapshots.add({ id, createdAt: nowIso(), reason, backup });
    const needed = new Set(
      (await db.eventBatches.filter((b) => Boolean(b.snapshotId) && !b.undoneAt).toArray()).map(
        (b) => b.snapshotId,
      ),
    );
    const all = await db.snapshots.orderBy("createdAt").reverse().primaryKeys();
    const stale = all.slice(SNAPSHOTS_KEPT).filter((key) => !needed.has(key));
    if (stale.length) await db.snapshots.bulkDelete(stale);
  });
  return id;
}

/** Whether the snapshot is still on this device, without reading its (large) contents. */
export async function hasSnapshot(id: string): Promise<boolean> {
  return (await db.snapshots.where(":id").equals(id).count()) > 0;
}

/** Ids of every snapshot on this device. */
export async function snapshotIds(): Promise<Set<string>> {
  return new Set(await db.snapshots.toCollection().primaryKeys());
}

export type SnapshotData =
  | { ok: true; data: BackupData; createdAt: string; reason: string }
  | { ok: false; message: string };

export const SNAPSHOT_GONE_MESSAGE = "That saved copy is no longer on this device.";

/** Reads and validates a snapshot's data. Never throws. */
export async function readSnapshot(id: string): Promise<SnapshotData> {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) return { ok: false, message: SNAPSHOT_GONE_MESSAGE };
  const parsed = parseBackup(snapshot.backup);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return {
    ok: true,
    data: parsed.backup.data,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
  };
}

export async function listSnapshots(): Promise<SnapshotSummary[]> {
  const rows = await db.snapshots.orderBy("createdAt").reverse().toArray();
  return rows.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    reason: s.reason,
    wineCount: s.backup.data.wines.filter((w) => !w.deletedAt).length,
    bottleCount: s.backup.data.lots.reduce((sum, lot) => sum + lot.quantity, 0),
  }));
}

/**
 * Clears every backed-up table and fills it from `data`, keeping device-only settings. Must run
 * inside a read-write transaction over `BACKUP_TABLES` (see `replaceAllData`).
 */
export async function replaceTables(data: BackupData): Promise<void> {
  for (const table of BACKUP_TABLES) {
    if (table === "settings") continue;
    await db.table(table).clear();
    await db.table(table).bulkAdd(data[table]);
  }
  const keepKeys = new Set(DEVICE_ONLY_SETTING_KEYS);
  const oldKeys = (await db.settings.toCollection().primaryKeys()).filter((k) => !keepKeys.has(k));
  await db.settings.bulkDelete(oldKeys);
  await db.settings.bulkPut(data.settings.filter((row) => !keepKeys.has(row.key)));
}

/**
 * Replaces every backed-up table with `data` in one transaction and records `batch`
 * (a restore-type event whose undo brings back its snapshot). Device-only settings are kept.
 */
export async function replaceAllData(
  data: BackupData,
  batch: Pick<EventBatch, "command" | "summary" | "snapshotId">,
): Promise<string> {
  const batchId = newId();
  await db.transaction("rw", BACKUP_TABLES, async () => {
    await replaceTables(data);
    const t = nowIso();
    await db.eventBatches.add({
      id: batchId,
      createdAt: t,
      updatedAt: t,
      source: "restore",
      changes: [],
      undoneAt: null,
      ...batch,
    });
  });
  return batchId;
}

/**
 * Restore replaces all data (R21). A safety snapshot is taken first; undoing the returned
 * batch (or calling `restoreSnapshot(snapshotId)`) brings the previous data back (AE6).
 */
export async function restoreBackup(
  file: BackupFile,
): Promise<{ snapshotId: string; batchId: string }> {
  const snapshotId = await takeSnapshot("Before restoring a backup");
  const batchId = await replaceAllData(file.data, {
    command: "restoreBackup",
    summary: `Restored a backup from ${formatDate(file.exportedAt)}`,
    snapshotId,
  });
  return { snapshotId, batchId };
}

/** Brings back a safety snapshot. The current data is itself snapshotted first. */
export async function restoreSnapshot(
  id: string,
): Promise<{ snapshotId: string; batchId: string }> {
  const snapshot = await readSnapshot(id);
  if (!snapshot.ok) throw new Error(snapshot.message);

  const snapshotId = await takeSnapshot("Before bringing back an earlier copy");
  const batchId = await replaceAllData(snapshot.data, {
    command: "restoreSnapshot",
    summary: `Brought back the copy saved ${formatDate(snapshot.createdAt)} (${snapshot.reason.toLowerCase()})`,
    snapshotId,
  });
  return { snapshotId, batchId };
}

/** Records a finished backup: resets the change counter used by backup reminders (R22). */
export async function markBackupDone(): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    await setSetting(SETTING_KEYS.lastBackupAt, nowIso());
    await setSetting(SETTING_KEYS.changesSinceBackup, 0);
  });
}
