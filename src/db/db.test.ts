import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, onVersionChange } from "./db";
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSIONS } from "./migrations";
import { getSetting, setSetting } from "./settings";
import { makeLot, makeWine, resetDatabase } from "./testing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("database", () => {
  beforeEach(resetDatabase);

  it("stores a wine and a lot and reads them back unchanged, with UUIDs and timestamps", async () => {
    const wine = makeWine({ producer: "Château Margaux", name: "", vintage: 2015 });
    const lot = makeLot({ wineId: wine.id, quantity: 3, pricePerBottle: 450, currency: "GBP" });
    await db.wines.add(wine);
    await db.lots.add(lot);

    const storedWine = await db.wines.get(wine.id);
    const storedLot = await db.lots.get(lot.id);
    expect(storedWine).toEqual(wine);
    expect(storedLot).toEqual(lot);
    expect(storedWine?.id).toMatch(UUID);
    expect(storedLot?.id).toMatch(UUID);
    expect(Date.parse(storedWine?.createdAt ?? "")).not.toBeNaN();
    expect(Date.parse(storedLot?.updatedAt ?? "")).not.toBeNaN();
    expect(await db.lots.where("wineId").equals(wine.id).count()).toBe(1);
  });

  it("stores settings as key and value rows", async () => {
    expect(await getSetting("currency", "GBP")).toBe("GBP");
    await setSetting("currency", "USD");
    expect(await getSetting("currency", "GBP")).toBe("USD");
    expect(await db.settings.get("currency")).toEqual({ key: "currency", value: "USD" });
  });

  it("opens at the current schema version", async () => {
    await db.open();
    expect(db.verno).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("tells listeners and closes when another tab upgrades the database", async () => {
    await db.open();
    const listener = vi.fn();
    const unsubscribe = onVersionChange(listener);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const newer = new Dexie("vintry");
    for (const v of SCHEMA_VERSIONS) newer.version(v.version).stores(v.stores);
    newer.version(CURRENT_SCHEMA_VERSION + 1).stores({});
    await newer.open();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(db.isOpen()).toBe(false);

    unsubscribe();
    newer.close();
    await newer.delete();
    warn.mockRestore();
  });
});
