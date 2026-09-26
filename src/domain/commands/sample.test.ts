import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { getSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { clearSampleCellar, loadSampleCellar } from "./sample";
import { addBottles } from "./wines";

const tables = ["wines", "lots", "consumptions", "tastingNotes", "locations", "wishlist"] as const;

describe("sample cellar", () => {
  beforeEach(resetDatabase);

  it("marks every row it creates as a sample, with source sample and no backup-reminder count", async () => {
    const result = await loadSampleCellar({});
    expect(await db.wines.count()).toBeGreaterThanOrEqual(20);
    expect(await db.locations.count()).toBe(2);
    for (const table of tables) {
      const rows = (await db.table(table).toArray()) as { isSample: boolean }[];
      expect(rows.every((row) => row.isSample)).toBe(true);
    }
    expect((await db.eventBatches.get(result.batchId ?? ""))?.source).toBe("sample");
    expect(await getSetting("changesSinceBackup", 0)).toBe(0);
  });

  it("refuses to load the sample twice", async () => {
    await loadSampleCellar({});
    await expect(loadSampleCellar({})).rejects.toThrow("The sample cellar is already loaded.");
  });

  it("clearing removes only sample rows and keeps the user's own wines", async () => {
    await loadSampleCellar({});
    await addBottles({
      drafts: [
        {
          producer: "Domaine Tempier",
          name: "Bandol",
          vintage: 2020,
          colour: "rose",
          lots: [{ quantity: 2 }],
        },
      ],
    });
    const result = await clearSampleCellar({});

    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.producer)).toEqual(["Domaine Tempier"]);
    expect(await db.lots.count()).toBe(1);
    expect(await db.locations.count()).toBe(0);
    expect(await db.consumptions.count()).toBe(0);
    expect((await db.eventBatches.get(result.batchId ?? ""))?.source).toBe("sample");
    expect(await getSetting("changesSinceBackup", 0)).toBe(1);
  });

  it("keeps a sample location that the user's own bottles now use", async () => {
    await loadSampleCellar({});
    const location = (await db.locations.toArray())[0]!;
    await addBottles({
      drafts: [
        {
          producer: "Domaine Tempier",
          vintage: 2020,
          colour: "rose",
          lots: [{ quantity: 2, locationId: location.id }],
        },
      ],
    });
    await clearSampleCellar({});
    expect(await db.locations.get(location.id)).toMatchObject({ isSample: false });
  });
});
