import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { buildCellarCsv } from "./cellarCsv";

describe("buildCellarCsv", () => {
  beforeEach(resetDatabase);

  it("writes one row per open lot, with the wine's own details", async () => {
    const location = makeLocation({ name: "Kitchen rack" });
    await db.locations.add(location);
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    await db.wines.add(wine);
    await db.lots.add(
      makeLot({
        wineId: wine.id,
        locationId: location.id,
        bin: "A1",
        quantity: 6,
        pricePerBottle: 250,
        currency: "USD",
      }),
    );

    const csv = await buildCellarCsv();
    expect(csv).toContain("Producer,Wine,Vintage");
    expect(csv).toContain("Ridge,Monte Bello,2019,Red");
    expect(csv).toContain("Kitchen rack,A1");
    expect(csv).toContain("250,USD");
  });

  it("skips a closed (empty) lot", async () => {
    const wine = makeWine();
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, quantity: 0 }));

    const csv = await buildCellarCsv();
    expect(csv.trim().split("\n")).toHaveLength(1); // header only
  });

  it("skips a lot whose wine has been deleted", async () => {
    const wine = makeWine({ deletedAt: "2026-01-01T00:00:00.000Z" });
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, quantity: 3 }));

    const csv = await buildCellarCsv();
    expect(csv.trim().split("\n")).toHaveLength(1);
  });

  it("shows NV for a non-vintage wine", async () => {
    const wine = makeWine({ vintage: null });
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, quantity: 1 }));

    const csv = await buildCellarCsv();
    expect(csv).toContain(",NV,");
  });
});
