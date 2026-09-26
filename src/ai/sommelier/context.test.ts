import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { buildCellarSnapshot, describeScreen, LOT_TABLE_LIMIT } from "./context";

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
});

async function seedLots(count: number) {
  const location = makeLocation({ name: "EuroCave A" });
  const wines = Array.from({ length: count }, (_, i) =>
    makeWine({ producer: `Producer ${i}`, windowFrom: 2020, windowTo: 2040 }),
  );
  const lots = wines.map((wine) =>
    makeLot({ wineId: wine.id, quantity: 2, locationId: location.id }),
  );
  await db.locations.add(location);
  await db.wines.bulkAdd(wines);
  await db.lots.bulkAdd(lots);
  return { lots, location };
}

describe("buildCellarSnapshot", () => {
  it(`includes the full lot table for a cellar of 150 lots (limit ${LOT_TABLE_LIMIT})`, async () => {
    const { lots, location } = await seedLots(150);
    const snapshot = await buildCellarSnapshot();
    expect(snapshot).toContain("Cellar snapshot, 2026-09-26.");
    expect(snapshot).toContain("Totals: 300 bottles of 150 wines in 150 open lots.");
    expect(snapshot).toContain("Ready 150");
    expect(snapshot).toContain(`EuroCave A | ${location.id} | 300`);
    expect(snapshot).toContain("Open lots (lot id | wine id");
    for (const lot of lots) expect(snapshot).toContain(lot.id);
  });

  it("sends only the summary for a cellar of 250 lots", async () => {
    const { lots } = await seedLots(250);
    const snapshot = await buildCellarSnapshot();
    expect(snapshot).toContain("Totals: 500 bottles of 250 wines in 250 open lots.");
    expect(snapshot).not.toContain("Open lots (");
    expect(snapshot).toContain("left out");
    expect(snapshot).not.toContain(lots[0]?.id ?? "missing");
  });

  it("leaves out closed lots and deleted wines", async () => {
    const wine = makeWine();
    const gone = makeWine({ producer: "Gone", deletedAt: "2026-09-01T00:00:00Z" });
    await db.wines.bulkAdd([wine, gone]);
    await db.lots.bulkAdd([
      makeLot({ wineId: wine.id, quantity: 0 }),
      makeLot({ wineId: gone.id, quantity: 3 }),
    ]);
    const snapshot = await buildCellarSnapshot();
    expect(snapshot).toContain("Totals: 0 bottles of 0 wines in 0 open lots.");
    expect(snapshot).toContain("There are no bottles in the cellar.");
  });
});

describe("describeScreen", () => {
  it("names the wine the user came from, and nothing for unknown ids", async () => {
    const wine = makeWine();
    await db.wines.add(wine);
    expect(await describeScreen({ wineId: wine.id })).toContain(
      `Ridge Monte Bello 2019 (wine id ${wine.id})`,
    );
    expect(await describeScreen({ wineId: "nope" })).toBeNull();
    expect(await describeScreen(undefined)).toBeNull();
  });
});
