import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { exportBackup, parseBackup } from "../../db/backup";
import { getSetting } from "../../db/settings";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../clock";
import { getCellarList } from "../selectors";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { addBottles, deleteWine, importRows, purgeDeleted, restoreWine, updateWine } from "./wines";

const monteBello = {
  producer: "Ridge",
  name: "Monte Bello",
  vintage: 2019,
  colour: "red" as const,
  country: "USA",
  region: "Santa Cruz Mountains",
  grapes: ["Cabernet Sauvignon", "Merlot"],
};

describe("addBottles", () => {
  beforeEach(resetDatabase);

  it("creates one wine, one lot and one event batch with source user for a new wine", async () => {
    const result = await addBottles({
      drafts: [{ ...monteBello, lots: [{ quantity: 6, pricePerBottle: 250, currency: "USD" }] }],
    });

    const wines = await db.wines.toArray();
    const lots = await db.lots.toArray();
    const batches = await db.eventBatches.toArray();
    expect(wines).toHaveLength(1);
    expect(wines[0]).toMatchObject({ ...monteBello, bottleSize: 750, isSample: false });
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ wineId: wines[0]?.id, quantity: 6, pricePerBottle: 250 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: result.batchId, source: "user", command: "addBottles" });
    expect(result.summary).toBe("Added 6 bottles of Ridge Monte Bello 2019");
    expect(result.touched.wineIds).toEqual([wines[0]?.id]);
    expect(result.touched.lotIds).toEqual([lots[0]?.id]);
  });

  it("adds a lot to an existing wine when the draft matches it", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 6 }] }] });
    const result = await addBottles(
      { drafts: [{ ...monteBello, producer: "RIDGE", lots: [{ quantity: 3 }] }] },
      { source: "ai-scan" },
    );

    expect(await db.wines.count()).toBe(1);
    expect(await db.lots.count()).toBe(2);
    // The existing wine is reported as touched so the UI can open it.
    expect(result.touched.wineIds).toEqual([(await db.wines.toArray())[0]?.id]);
    const batch = await db.eventBatches.get(result.batchId ?? "");
    expect(batch?.source).toBe("ai-scan");
  });

  it("attaches to the wine named by wineId", async () => {
    const first = await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    const wineId = (await db.wines.toArray())[0]?.id;
    await addBottles({
      drafts: [
        { ...monteBello, name: "Monte Bello (label misread)", wineId, lots: [{ quantity: 2 }] },
      ],
    });
    expect(first.batchId).toBeTruthy();
    expect(await db.wines.count()).toBe(1);
  });

  it("never attaches real bottles to a sample wine named by wineId: adds a real wine instead", async () => {
    const sample = makeWine({ ...monteBello, isSample: true });
    await db.wines.add(sample);

    const result = await addBottles({
      drafts: [{ ...monteBello, wineId: sample.id, lots: [{ quantity: 2 }] }],
    });

    const real = (await db.wines.toArray()).filter((w) => !w.isSample);
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    expect(result.touched.wineIds).toEqual([real[0]?.id]);
    const lots = await db.lots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ wineId: real[0]?.id, quantity: 2, isSample: false });
  });

  it("re-routes a sample wineId to the matching real wine when there is one", async () => {
    const sample = makeWine({ ...monteBello, isSample: true });
    await db.wines.add(sample);
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    const realId = (await db.wines.filter((w) => !w.isSample).first())?.id;

    await addBottles({ drafts: [{ ...monteBello, wineId: sample.id, lots: [{ quantity: 2 }] }] });
    expect(await db.wines.count()).toBe(2);
    expect(await db.lots.where("wineId").equals(sample.id).count()).toBe(0);
    expect(await db.lots.where("wineId").equals(realId!).count()).toBe(2);
  });

  it("treats a magnum as a different wine", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 6 }] }] });
    await addBottles({ drafts: [{ ...monteBello, bottleSize: 1500, lots: [{ quantity: 1 }] }] });
    expect(await db.wines.count()).toBe(2);
  });

  it("rejects invalid input with a readable message and writes nothing", async () => {
    const attempt = addBottles({
      drafts: [{ ...monteBello, producer: "", lots: [{ quantity: 0 }] }],
    });
    await expect(attempt).rejects.toBeInstanceOf(CommandError);
    await expect(attempt).rejects.toThrow(/producer/);
    expect(await db.wines.count()).toBe(0);
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("refuses a draft without bottles", async () => {
    await expect(addBottles({ drafts: [{ ...monteBello, lots: [] }] })).rejects.toThrow();
  });

  it("refuses an unknown location", async () => {
    await expect(
      addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1, locationId: "nope" }] }] }),
    ).rejects.toThrow(/location/i);
    expect(await db.wines.count()).toBe(0);
  });

  it("counts one change towards the backup reminder", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    expect(await getSetting("changesSinceBackup", 0)).toBe(2);
  });
});

describe("importRows", () => {
  beforeEach(resetDatabase);

  it("adds every row in one batch with source import, matching duplicates within the file", async () => {
    const result = await importRows({
      rows: [
        { ...monteBello, lots: [{ quantity: 6 }] },
        { ...monteBello, lots: [{ quantity: 2 }] },
        { producer: "Krug", name: "Grande Cuvée", vintage: null, colour: "sparkling", lots: [] },
      ],
    });
    expect(await db.wines.count()).toBe(2);
    expect(await db.lots.count()).toBe(2);
    const batches = await db.eventBatches.toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.source).toBe("import");
    expect(result.summary).toBe("Imported 2 wines (8 bottles)");
  });

  describe("CellarTracker's wine id", () => {
    it("is kept on a wine a row creates", async () => {
      await importRows({ rows: [{ ...monteBello, cellarTrackerId: "100001", lots: [] }] });
      expect((await db.wines.toArray())[0]?.cellarTrackerId).toBe("100001");
    });

    it("is recorded on a matched wine that had none, and undo takes it off again", async () => {
      await db.wines.add(makeWine({ id: "w1" }));
      const result = await importRows({
        rows: [{ ...monteBello, cellarTrackerId: "100001", lots: [{ quantity: 1 }] }],
      });
      expect(await db.wines.count()).toBe(1);
      expect((await db.wines.get("w1"))?.cellarTrackerId).toBe("100001");
      await undoBatch(result.batchId!);
      expect((await db.wines.get("w1"))?.cellarTrackerId).toBeUndefined();
      expect(await db.lots.count()).toBe(0);
    });

    it("never replaces a wine's own id", async () => {
      await db.wines.add(makeWine({ id: "w1", cellarTrackerId: "100001" }));
      await importRows({
        rows: [{ ...monteBello, cellarTrackerId: "999", lots: [{ quantity: 1 }] }],
      });
      expect((await db.wines.get("w1"))?.cellarTrackerId).toBe("100001");
      expect(await db.wines.count()).toBe(1);
    });

    it("matches first, so a wine renamed in Vintry still gets its bottles", async () => {
      await db.wines.add(
        makeWine({ id: "w1", name: "Monte Bello (estate)", cellarTrackerId: "100001" }),
      );
      // The same name and vintage as another wine does not win over the id.
      await db.wines.add(makeWine({ id: "w2", name: "Monte Bello" }));
      await importRows({
        rows: [{ ...monteBello, cellarTrackerId: "100001", lots: [{ quantity: 2 }] }],
      });
      expect(await db.wines.count()).toBe(2);
      const lots = await db.lots.toArray();
      expect(lots.map((l) => [l.wineId, l.quantity])).toEqual([["w1", 2]]);
    });

    it("round-trips through a backup", async () => {
      await importRows({ rows: [{ ...monteBello, cellarTrackerId: "100001", lots: [] }] });
      const parsed = parseBackup(JSON.stringify(await exportBackup()));
      expect(parsed.ok && parsed.backup.data.wines[0]?.cellarTrackerId).toBe("100001");
    });
  });

  it("imports 300 rows quickly", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      producer: `Producer ${i}`,
      name: "Cuvée",
      vintage: 2000 + (i % 20),
      colour: "red" as const,
      lots: [{ quantity: 1 + (i % 6) }],
    }));
    const started = performance.now();
    await importRows({ rows });
    // A guard against an order-of-magnitude regression, not a benchmark (machines under load vary).
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(await db.wines.count()).toBe(300);
  });

  it("keeps 750 ml and magnum rows with the same CellarTracker id as two wines", async () => {
    await importRows({
      rows: [
        { ...monteBello, cellarTrackerId: "100001", lots: [{ quantity: 6 }] },
        { ...monteBello, bottleSize: 1500, cellarTrackerId: "100001", lots: [{ quantity: 2 }] },
      ],
    });
    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.bottleSize).sort()).toEqual([1500, 750]);
    // Importing the file again tops each size up separately, never mixing them.
    await importRows({
      rows: [
        { ...monteBello, bottleSize: 1500, cellarTrackerId: "100001", lots: [{ quantity: 1 }] },
      ],
    });
    const magnum = (await db.wines.toArray()).find((w) => w.bottleSize === 1500)!;
    const magnumBottles = (await db.lots.where("wineId").equals(magnum.id).toArray()).reduce(
      (sum, l) => sum + l.quantity,
      0,
    );
    expect(magnumBottles).toBe(3);
    expect(await db.wines.count()).toBe(2);
  });

  it("creates the file's new locations in the same batch, and one undo removes them", async () => {
    await db.locations.add({
      id: "kitchen",
      name: "Kitchen rack",
      notes: null,
      isSample: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await importRows({
      rows: [
        { ...monteBello, lots: [{ quantity: 6, locationId: "tmp-rack-1" }] },
        {
          producer: "Krug",
          vintage: null,
          colour: "sparkling",
          lots: [{ quantity: 2, locationId: "tmp-kitchen" }],
        },
      ],
      newLocations: [
        { id: "tmp-rack-1", name: " Rack  1 " },
        // Already exists under another spelling, so the lot goes to the existing location.
        { id: "tmp-kitchen", name: "KITCHEN RACK" },
      ],
    });
    expect(result.summary).toBe("Imported 2 wines (8 bottles) and created 1 location");
    const locations = await db.locations.toArray();
    expect(locations.map((l) => l.name).sort()).toEqual(["Kitchen rack", "Rack 1"]);
    const lots = await db.lots.toArray();
    expect(lots.map((l) => l.locationId).sort()).toEqual(["kitchen", "tmp-rack-1"]);
    expect(await db.eventBatches.count()).toBe(1);

    await undoBatch(result.batchId!);
    expect(await db.lots.count()).toBe(0);
    expect((await db.locations.toArray()).map((l) => l.name)).toEqual(["Kitchen rack"]);
  });
});

describe("updateWine", () => {
  beforeEach(resetDatabase);

  it("marks a window from a sommelier edit as an AI estimate, never as the collector's", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    const wine = (await db.wines.toArray())[0]!;
    await updateWine(
      { wineId: wine.id, patch: { windowFrom: 2027, windowTo: 2040 } },
      { source: "ai-chat" },
    );
    expect((await db.wines.get(wine.id))?.windowSource).toBe("ai");
    await updateWine(
      { wineId: wine.id, patch: { windowFrom: 2028, windowTo: 2041, windowSource: "user" } },
      { source: "ai-chat" },
    );
    expect((await db.wines.get(wine.id))?.windowSource).toBe("ai");
  });

  it("changes the given fields and marks a hand-edited window as user-set", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 1 }] }] });
    const wine = (await db.wines.toArray())[0]!;
    const result = await updateWine({
      wineId: wine.id,
      patch: { region: "Cupertino", windowFrom: 2027, windowTo: 2045 },
    });
    const stored = await db.wines.get(wine.id);
    expect(stored).toMatchObject({ region: "Cupertino", windowFrom: 2027, windowSource: "user" });
    expect(stored?.updatedAt).not.toBe(wine.updatedAt);
    expect(result.summary).toBe("Edited Ridge Monte Bello 2019");
  });

  it("fails for a missing wine", async () => {
    await expect(updateWine({ wineId: "missing", patch: { notes: "x" } })).rejects.toThrow(
      /not found|no longer/i,
    );
  });
});

describe("deleteWine, restoreWine and purgeDeleted", () => {
  beforeEach(resetDatabase);

  it("soft-deletes a wine, hides it from the cellar, and restore brings it back", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 2 }] }] });
    const wine = (await db.wines.toArray())[0]!;

    const deleted = await deleteWine({ wineId: wine.id });
    expect((await db.wines.get(wine.id))?.deletedAt).toBeTruthy();
    expect(await getCellarList({ includeDrunk: true })).toHaveLength(0);
    expect(deleted.summary).toBe("Deleted Ridge Monte Bello 2019");

    await restoreWine({ wineId: wine.id });
    expect((await db.wines.get(wine.id))?.deletedAt).toBeNull();
    expect(await getCellarList({})).toHaveLength(1);
  });

  it("purges wines deleted more than 30 days ago, with their lots and history", async () => {
    setClock("2026-08-01T12:00:00Z");
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 2 }] }] });
    await addBottles({ drafts: [{ ...monteBello, vintage: 2018, lots: [{ quantity: 1 }] }] });
    const [old, recent] = await db.wines.orderBy("vintage").reverse().toArray();
    await deleteWine({ wineId: old!.id });
    setClock("2026-09-20T12:00:00Z");
    await deleteWine({ wineId: recent!.id });

    const result = await purgeDeleted({});
    expect(await db.wines.get(old!.id)).toBeUndefined();
    expect(await db.lots.where("wineId").equals(old!.id).count()).toBe(0);
    expect(await db.wines.get(recent!.id)).toBeDefined();
    expect(result.summary).toBe("Permanently removed 1 deleted wine");
  });

  it("permanently removes one deleted wine on request, whatever its age", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 2 }] }] });
    const wine = (await db.wines.toArray())[0]!;
    await deleteWine({ wineId: wine.id });

    const result = await purgeDeleted({ wineId: wine.id });
    expect(await db.wines.get(wine.id)).toBeUndefined();
    expect(await db.lots.where("wineId").equals(wine.id).count()).toBe(0);
    expect(result.summary).toBe("Permanently removed 1 deleted wine");
  });

  it("refuses to permanently remove a wine that is not deleted", async () => {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 2 }] }] });
    const wine = (await db.wines.toArray())[0]!;
    await expect(purgeDeleted({ wineId: wine.id })).rejects.toThrow(
      "Only deleted wines can be removed permanently.",
    );
    expect(await db.wines.get(wine.id)).toBeDefined();
  });

  it("does nothing and records no batch when there is nothing to purge", async () => {
    const result = await purgeDeleted({});
    expect(result.batchId).toBeNull();
    expect(await db.eventBatches.count()).toBe(0);
  });
});

describe("updateWine: market value (collector-entered only)", () => {
  beforeEach(resetDatabase);

  async function oneWine() {
    await addBottles({ drafts: [{ ...monteBello, lots: [{ quantity: 2 }] }] });
    return (await db.wines.toArray())[0]!;
  }

  it("new and older wines have no value", async () => {
    const wine = await oneWine();
    expect(wine).toMatchObject({ valuePerBottle: null, valueCurrency: null, valueUpdatedAt: null });
  });

  it("sets the value per bottle with its currency and stamps when it was updated", async () => {
    const wine = await oneWine();
    setClock("2026-09-03T10:00:00Z");
    await updateWine({ wineId: wine.id, patch: { valuePerBottle: 120, valueCurrency: "GBP" } });
    expect(await db.wines.get(wine.id)).toMatchObject({
      valuePerBottle: 120,
      valueCurrency: "GBP",
      valueUpdatedAt: "2026-09-03T10:00:00.000Z",
    });
  });

  it("re-stamps only when the value changes, and clearing the value clears its currency", async () => {
    const wine = await oneWine();
    setClock("2026-09-03T10:00:00Z");
    await updateWine({ wineId: wine.id, patch: { valuePerBottle: 120, valueCurrency: "GBP" } });
    setClock("2026-09-10T10:00:00Z");
    await updateWine({ wineId: wine.id, patch: { region: "Cupertino" } });
    expect((await db.wines.get(wine.id))?.valueUpdatedAt).toBe("2026-09-03T10:00:00.000Z");

    setClock("2026-09-12T10:00:00Z");
    await updateWine({ wineId: wine.id, patch: { valuePerBottle: null } });
    const cleared = await db.wines.get(wine.id);
    expect(cleared).toMatchObject({ valuePerBottle: null, valueCurrency: null });
    expect(cleared?.valueUpdatedAt).toMatch(/^2026-09-12/);
  });

  it("needs a currency with a value", async () => {
    const wine = await oneWine();
    await expect(updateWine({ wineId: wine.id, patch: { valuePerBottle: 90 } })).rejects.toThrow(
      /currency/i,
    );
    expect((await db.wines.get(wine.id))?.valuePerBottle).toBeNull();
  });

  it("refuses a value from the sommelier or any other non-user source, writing nothing", async () => {
    const wine = await oneWine();
    for (const source of ["ai-chat", "ai-scan", "import"] as const) {
      await expect(
        updateWine(
          { wineId: wine.id, patch: { valuePerBottle: 500, valueCurrency: "USD", notes: "x" } },
          { source },
        ),
      ).rejects.toThrow(CommandError);
    }
    expect(await db.wines.get(wine.id)).toMatchObject({ valuePerBottle: null, notes: null });
    // Other edits from the sommelier still work.
    await updateWine({ wineId: wine.id, patch: { notes: "Decant" } }, { source: "ai-chat" });
    expect((await db.wines.get(wine.id))?.notes).toBe("Decant");
  });

  it("undo restores the previous value", async () => {
    const wine = await oneWine();
    const result = await updateWine({
      wineId: wine.id,
      patch: { valuePerBottle: 120, valueCurrency: "GBP" },
    });
    await undoBatch(result.batchId!);
    expect(await db.wines.get(wine.id)).toMatchObject({
      valuePerBottle: null,
      valueCurrency: null,
    });
  });

  it("round-trips through a backup, and older backups without a value still parse", async () => {
    const wine = await oneWine();
    await updateWine({ wineId: wine.id, patch: { valuePerBottle: 120, valueCurrency: "GBP" } });
    const file = await exportBackup();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.data.wines[0]).toMatchObject({
      valuePerBottle: 120,
      valueCurrency: "GBP",
    });

    const older = structuredClone(file);
    for (const row of older.data.wines as Record<string, unknown>[]) {
      delete row.valuePerBottle;
      delete row.valueCurrency;
      delete row.valueUpdatedAt;
    }
    const parsedOld = parseBackup(older);
    expect(parsedOld.ok && parsedOld.backup.data.wines[0]).toMatchObject({
      valuePerBottle: null,
      valueCurrency: null,
      valueUpdatedAt: null,
    });
  });
});
