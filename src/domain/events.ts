import { db } from "../db/db";
import { nowIso } from "./clock";
import type {
  Change,
  Consumption,
  Location,
  Lot,
  RecordTableName,
  TastingNote,
  Wine,
  WishlistItem,
} from "./types";

/** Row type for each record table. */
export interface RowOf {
  wines: Wine;
  lots: Lot;
  consumptions: Consumption;
  tastingNotes: TastingNote;
  locations: Location;
  wishlist: WishlistItem;
}

type AnyRow = { id: string; updatedAt: string } & Record<string, unknown>;

const tableOf = (name: RecordTableName) => db.table<AnyRow, string>(name);

/**
 * Records every write a command makes, so the event batch holds a before and after image of
 * each touched record (KTD4, KTD7). Use it inside the command's transaction.
 */
export class ChangeSet {
  private readonly changes = new Map<string, Change>();

  private record(table: RecordTableName, id: string, before: AnyRow | null, after: AnyRow | null) {
    const key = `${table}:${id}`;
    const earlier = this.changes.get(key);
    this.changes.set(key, {
      table,
      id,
      before: earlier ? earlier.before : before && { ...before },
      after: after && { ...after },
    });
  }

  async get<K extends RecordTableName>(table: K, id: string): Promise<RowOf[K] | undefined> {
    return (await tableOf(table).get(id)) as RowOf[K] | undefined;
  }

  async insert<K extends RecordTableName>(table: K, row: RowOf[K]): Promise<RowOf[K]> {
    await tableOf(table).add(row as unknown as AnyRow);
    this.record(table, row.id, null, row as unknown as AnyRow);
    return row;
  }

  /** Merges `patch` into the row and stamps `updatedAt`. Returns the new row. */
  async update<K extends RecordTableName>(
    table: K,
    id: string,
    patch: Partial<RowOf[K]>,
  ): Promise<RowOf[K]> {
    const before = await tableOf(table).get(id);
    if (!before) throw new Error(`Missing ${table} record ${id}`);
    const after = { ...before, ...patch, id, updatedAt: nowIso() } as AnyRow;
    await tableOf(table).put(after);
    this.record(table, id, before, after);
    return after as unknown as RowOf[K];
  }

  /** Hard-deletes a row (soft delete of wines is an `update` of `deletedAt`). */
  async remove(table: RecordTableName, id: string): Promise<void> {
    const before = await tableOf(table).get(id);
    if (!before) return;
    await tableOf(table).delete(id);
    this.record(table, id, before, null);
  }

  list(): Change[] {
    return [...this.changes.values()].filter((c) => c.before !== null || c.after !== null);
  }
}

/** IDs a command or batch touched, grouped by table. */
export interface Touched {
  wineIds: string[];
  lotIds: string[];
  consumptionIds: string[];
  tastingNoteIds: string[];
  locationIds: string[];
  wishlistIds: string[];
}

const TOUCHED_KEY: Record<RecordTableName, keyof Touched> = {
  wines: "wineIds",
  lots: "lotIds",
  consumptions: "consumptionIds",
  tastingNotes: "tastingNoteIds",
  locations: "locationIds",
  wishlist: "wishlistIds",
};

/** Fields that point at another record, used by undo and by `touchedFromChanges`. */
export const REFERENCE_FIELDS: Record<string, RecordTableName> = {
  wineId: "wines",
  lotId: "lots",
  locationId: "locations",
  consumptionId: "consumptions",
};

/** Records referenced by a row image, for example a lot's wine and location. */
export function referencesOf(row: Record<string, unknown> | null): [RecordTableName, string][] {
  if (!row) return [];
  const out: [RecordTableName, string][] = [];
  for (const [field, table] of Object.entries(REFERENCE_FIELDS)) {
    const value = row[field];
    if (typeof value === "string" && value) out.push([table, value]);
  }
  return out;
}

/**
 * Touched IDs from a list of changes. A changed lot, consumption or note also reports its wine,
 * so the UI can open the wine a command affected.
 */
export function touchedFromChanges(changes: readonly Change[]): Touched {
  const sets: Record<keyof Touched, Set<string>> = {
    wineIds: new Set(),
    lotIds: new Set(),
    consumptionIds: new Set(),
    tastingNoteIds: new Set(),
    locationIds: new Set(),
    wishlistIds: new Set(),
  };
  for (const change of changes) {
    sets[TOUCHED_KEY[change.table]].add(change.id);
    const wineId = (change.after ?? change.before)?.wineId;
    if (typeof wineId === "string") sets.wineIds.add(wineId);
  }
  return {
    wineIds: [...sets.wineIds],
    lotIds: [...sets.lotIds],
    consumptionIds: [...sets.consumptionIds],
    tastingNoteIds: [...sets.tastingNoteIds],
    locationIds: [...sets.locationIds],
    wishlistIds: [...sets.wishlistIds],
  };
}

export const EMPTY_TOUCHED: Touched = touchedFromChanges([]);
