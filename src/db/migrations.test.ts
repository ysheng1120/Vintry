import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db";
import {
  CURRENT_SCHEMA_VERSION,
  migrateBackupData,
  SCHEMA_VERSIONS,
  type SchemaVersion,
} from "./migrations";
import { makeLocation, makeLot, makeWine } from "./testing";

const created: string[] = [];
function uniqueName(label: string) {
  const name = `vintry-migration-${label}-${Math.random().toString(36).slice(2)}`;
  created.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((name) => Dexie.delete(name)));
});

/** Opens a raw database at exactly `version`, as an older app release would have. */
async function seedAtVersion(name: string, version: number, rows: Record<string, unknown[]>) {
  const old = new Dexie(name);
  for (const v of SCHEMA_VERSIONS.filter((s) => s.version <= version)) {
    old.version(v.version).stores(v.stores);
  }
  await old.open();
  for (const [table, tableRows] of Object.entries(rows)) await old.table(table).bulkAdd(tableRows);
  old.close();
}

describe("schema migrations", () => {
  // Fixture pattern: repeat this test for every past version when a new version is added.
  it("opens a database seeded at version 1 under the current version with all rows intact", async () => {
    const name = uniqueName("v1");
    const wine = makeWine();
    const lot = makeLot({ wineId: wine.id });
    const location = makeLocation();
    await seedAtVersion(name, 1, {
      wines: [wine],
      lots: [lot],
      locations: [location],
      settings: [{ key: "currency", value: "GBP" }],
    });

    const upgraded = createDatabase(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(CURRENT_SCHEMA_VERSION);
    expect(await upgraded.wines.toArray()).toEqual([wine]);
    expect(await upgraded.lots.toArray()).toEqual([lot]);
    expect(await upgraded.locations.toArray()).toEqual([location]);
    expect(await upgraded.settings.get("currency")).toEqual({ key: "currency", value: "GBP" });
    upgraded.close();
  });

  // Exercises the upgrade plumbing with a made-up version 2 so future migrations are safe.
  const withTestVersion2: SchemaVersion[] = [
    ...SCHEMA_VERSIONS,
    {
      version: CURRENT_SCHEMA_VERSION + 1,
      stores: {},
      migrateRow: (table, row) => (table === "wines" ? { ...row, migrated: true } : row),
    },
  ];

  it("runs a version's row migration on the live database during upgrade", async () => {
    const name = uniqueName("plumbing");
    const wine = makeWine();
    const lot = makeLot({ wineId: wine.id });
    await seedAtVersion(name, CURRENT_SCHEMA_VERSION, { wines: [wine], lots: [lot] });

    const upgraded = createDatabase(name, withTestVersion2);
    await upgraded.open();
    expect(await upgraded.wines.get(wine.id)).toEqual({ ...wine, migrated: true });
    expect(await upgraded.lots.get(lot.id)).toEqual(lot);
    upgraded.close();
  });

  it("runs the same row migration on backup data from an older version", () => {
    const wine = makeWine();
    const data = { wines: [wine], lots: [] };
    expect(migrateBackupData(data, CURRENT_SCHEMA_VERSION, withTestVersion2)).toEqual({
      wines: [{ ...wine, migrated: true }],
      lots: [],
    });
    // Already at the newest version: nothing changes.
    expect(migrateBackupData(data, CURRENT_SCHEMA_VERSION + 1, withTestVersion2)).toEqual(data);
  });

  it("keeps row migrations pure (the input rows are not modified)", () => {
    const wine = makeWine();
    const copy = structuredClone(wine);
    migrateBackupData({ wines: [wine] }, CURRENT_SCHEMA_VERSION, withTestVersion2);
    expect(wine).toEqual(copy);
  });
});
