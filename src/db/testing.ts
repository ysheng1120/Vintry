/**
 * Test helpers for any unit that touches the database. Import only from `*.test.ts(x)` files.
 */
import { setClock } from "../domain/clock";
import {
  LocationSchema,
  LotSchema,
  WineSchema,
  type Location,
  type Lot,
  type Wine,
} from "../domain/types";
import { newId } from "../lib/id";
import { db } from "./db";

/** Empties every table and restores the real clock. Call in `beforeEach`. */
export async function resetDatabase(): Promise<void> {
  setClock(null);
  if (!db.isOpen()) await db.open();
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

const stamp = () => {
  const t = new Date().toISOString();
  return { id: newId(), createdAt: t, updatedAt: t };
};

/** A valid Wine row with defaults; override any field. Does not write it. */
export function makeWine(overrides: Partial<Wine> = {}): Wine {
  return WineSchema.parse({
    ...stamp(),
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    colour: "red",
    ...overrides,
  });
}

/** A valid Lot row with defaults; override any field. Does not write it. */
export function makeLot(overrides: Partial<Lot> & { wineId: string }): Lot {
  return LotSchema.parse({ ...stamp(), quantity: 6, ...overrides });
}

/** A valid Location row with defaults; override any field. Does not write it. */
export function makeLocation(overrides: Partial<Location> = {}): Location {
  return LocationSchema.parse({ ...stamp(), name: "Kitchen rack", ...overrides });
}
