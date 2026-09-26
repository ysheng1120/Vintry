import type Dexie from "dexie";

export type Row = Record<string, unknown>;

/**
 * One database schema version (R31, KTD16).
 *
 * To add version N: append an entry with only the changed `stores` and, when row shapes change,
 * a pure `migrateRow` that turns a version N-1 row into a version N row. The same function
 * upgrades the live database and older backup files (KTD15), so both stay in step. Add a
 * fixture test for version N-1 in `migrations.test.ts`.
 */
export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  migrateRow?: (table: string, row: Row) => Row;
}

export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      wines: "id, producer, vintage, colour, country, region, deletedAt, createdAt, updatedAt",
      lots: "id, wineId, locationId, closedAt, createdAt",
      consumptions: "id, date, wineId, lotId",
      tastingNotes: "id, wineId, consumptionId, date",
      locations: "id, name",
      wishlist: "id, createdAt",
      eventBatches: "id, createdAt",
      chatThreads: "id, updatedAt",
      chatMessages: "id, threadId, createdAt, [threadId+createdAt]",
      settings: "key",
      aiUsage: "id, createdAt, feature",
      snapshots: "id, createdAt",
    },
  },
];

export function latestVersion(versions: readonly SchemaVersion[] = SCHEMA_VERSIONS): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0);
}

export const CURRENT_SCHEMA_VERSION = latestVersion();

/** Tables whose rows never pass through `migrateRow` (snapshots hold whole backups instead). */
const UNMIGRATED_TABLES = new Set(["snapshots"]);

/** Declares every schema version and its upgrade on a Dexie instance. */
export function applySchemaVersions(
  db: Dexie,
  versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
) {
  for (const v of versions) {
    const declared = db.version(v.version).stores(v.stores);
    const migrateRow = v.migrateRow;
    if (!migrateRow) continue;
    declared.upgrade(async (tx) => {
      for (const table of tx.storeNames) {
        if (UNMIGRATED_TABLES.has(table)) continue;
        await tx
          .table(table)
          .toCollection()
          .modify((row: Row, ref: { value: Row }) => {
            ref.value = migrateRow(table, row);
          });
      }
    });
  }
}

/** Carries backup table data from `fromVersion` up to the latest version, one step at a time. */
export function migrateBackupData(
  data: Record<string, Row[]>,
  fromVersion: number,
  versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
): Record<string, Row[]> {
  let current = data;
  const steps = [...versions]
    .filter((v) => v.version > fromVersion)
    .sort((a, b) => a.version - b.version);
  for (const step of steps) {
    const migrateRow = step.migrateRow;
    if (!migrateRow) continue;
    current = Object.fromEntries(
      Object.entries(current).map(([table, rows]) => [
        table,
        rows.map((row) => migrateRow(table, row)),
      ]),
    );
  }
  return current;
}
