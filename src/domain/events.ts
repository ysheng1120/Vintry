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

/** Fields that point at another record, used by undo and by `touchedFromChanges`. */
export const REFERENCE_FIELDS: Record<string, RecordTableName> = {
  wineId: "wines",
  lotId: "lots",
  locationId: "locations",
  consumptionId: "consumptions",
};

type Row = Record<string, unknown>;

/** Structural equality for row values (JSON-like: primitives, arrays, plain objects). */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const defined = (row: Row) => Object.keys(row).filter((k) => row[k] !== undefined);
  const aKeys = defined(a as Row);
  if (aKeys.length !== defined(b as Row).length) return false;
  return aKeys.every((k) => sameValue((a as Row)[k], (b as Row)[k]));
}

/** What every compact or scrubbed image keeps: the id and the records the row points at. */
function keyFields(row: Row): Row {
  const out: Row = { id: row.id };
  for (const field of Object.keys(REFERENCE_FIELDS)) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  return out;
}

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = { ...keyFields(row), updatedAt: row.updatedAt };
  for (const field of fields) if (row[field] !== undefined) out[field] = row[field];
  return out;
}

/**
 * An update stored compactly (see `ChangeSchema`): only the fields whose value changed, plus
 * `id`, `updatedAt` and the reference fields. Unchanged large fields such as a wine's label image
 * are left out, so editing a wine's notes no longer stores two copies of the image.
 */
export function compactUpdate(table: RecordTableName, id: string, before: Row, after: Row): Change {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => field !== "id" && field !== "updatedAt" && !sameValue(before[field], after[field]),
  );
  return { table, id, before: pick(before, fields), after: pick(after, fields), fields };
}

/**
 * A change with the record's copies wiped, for a record deleted forever: only its id and the ids
 * it pointed at stay, so the history still knows what the change touched (undo's conflict check
 * relies on that). A batch holding a scrubbed change can't be undone.
 */
export function scrubChange(change: Change): Change {
  return {
    table: change.table,
    id: change.id,
    before: change.before && keyFields(change.before),
    after: change.after && keyFields(change.after),
    scrubbed: true,
  };
}

/**
 * Records every write a command makes, so the event batch holds a before and after image of
 * each touched record (KTD4, KTD7): whole rows for inserts and removals, only what changed for
 * updates (`compactUpdate`). Use it inside the command's transaction.
 */
export class ChangeSet {
  private readonly changes = new Map<string, Change>();
  private readonly forgotten = new Set<string>();

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

  /** Keeps no copy of this record in the batch (`scrubChange`), for records removed for good. */
  forget(table: RecordTableName, id: string): void {
    this.forgotten.add(`${table}:${id}`);
  }

  list(): Change[] {
    const out: Change[] = [];
    for (const [key, change] of this.changes) {
      const { table, id, before, after } = change;
      if (before === null && after === null) continue;
      if (this.forgotten.has(key)) out.push(scrubChange(change));
      else if (before && after) out.push(compactUpdate(table, id, before, after));
      else out.push(change);
    }
    return out;
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
