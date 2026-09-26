import Dexie, { type EntityTable } from "dexie";
import type {
  AiUsage,
  ChatMessage,
  ChatThread,
  Consumption,
  EventBatch,
  Location,
  Lot,
  SettingRow,
  TastingNote,
  Wine,
  WishlistItem,
} from "../domain/types";
import type { BackupFile } from "./backup-schema";
import { applySchemaVersions, type SchemaVersion, SCHEMA_VERSIONS } from "./migrations";

/** A full backup kept on this device before a restore or wipe (KTD15). */
export interface Snapshot {
  id: string;
  createdAt: string;
  /** Why it was taken, for example "Before restoring a backup". */
  reason: string;
  backup: BackupFile;
}

export type VintryDb = Dexie & {
  wines: EntityTable<Wine, "id">;
  lots: EntityTable<Lot, "id">;
  consumptions: EntityTable<Consumption, "id">;
  tastingNotes: EntityTable<TastingNote, "id">;
  locations: EntityTable<Location, "id">;
  wishlist: EntityTable<WishlistItem, "id">;
  eventBatches: EntityTable<EventBatch, "id">;
  chatThreads: EntityTable<ChatThread, "id">;
  chatMessages: EntityTable<ChatMessage, "id">;
  settings: EntityTable<SettingRow, "key">;
  aiUsage: EntityTable<AiUsage, "id">;
  snapshots: EntityTable<Snapshot, "id">;
};

export const DB_NAME = "vintry";

/** Builds a Vintry database. Tests pass a custom name or version list; the app uses `db`. */
export function createDatabase(
  name: string = DB_NAME,
  versions: readonly SchemaVersion[] = SCHEMA_VERSIONS,
): VintryDb {
  const database = new Dexie(name) as VintryDb;
  applySchemaVersions(database, versions);
  return database;
}

export const db: VintryDb = createDatabase();

type VersionChangeListener = () => void;
const versionChangeListeners = new Set<VersionChangeListener>();

// Another tab is upgrading the database: Dexie closes this connection so the upgrade can run,
// and the app shell asks the user to reload (R31, KTD16).
db.on("versionchange", (event: IDBVersionChangeEvent) => {
  if (event.newVersion === null || event.newVersion === 0) return; // database deleted, not upgraded
  for (const listener of versionChangeListeners) listener();
});

/** Subscribes to "another tab upgraded Vintry". Returns an unsubscribe function. */
export function onVersionChange(listener: VersionChangeListener): () => void {
  versionChangeListeners.add(listener);
  return () => {
    versionChangeListeners.delete(listener);
  };
}
