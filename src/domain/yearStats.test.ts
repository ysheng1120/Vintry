import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { resetDatabase } from "../db/testing";
import { setClock } from "./clock";
import { consumeBottles } from "./commands/consumption";
import { createLocation } from "./commands/locations";
import { moveBottles } from "./commands/lots";
import { addTastingNote } from "./commands/notes";
import { addBottles, deleteWine } from "./commands/wines";
import { getSpendingPerYear, getYearInWine, getYearsWithData } from "./yearStats";

async function seed() {
  setClock("2025-11-01T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Château Margaux",
        vintage: 2015,
        colour: "red",
        lots: [{ quantity: 3, purchaseDate: "2025-11-01", pricePerBottle: 500, currency: "GBP" }],
      },
    ],
  });
  setClock("2026-01-10T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity: 4, purchaseDate: "2026-01-10", pricePerBottle: 250, currency: "USD" }],
      },
    ],
  });
  setClock("2026-02-01T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Dr. Loosen",
        name: "Riesling Kabinett",
        vintage: 2021,
        colour: "white",
        lots: [{ quantity: 2, purchaseDate: "2026-02-01", pricePerBottle: 20, currency: "GBP" }],
      },
    ],
  });
  setClock("2026-02-02T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Taittinger",
        name: "Brut Réserve",
        vintage: null,
        colour: "sparkling",
        // No purchase date: bought bottles it may be, but it should never count towards a year.
        lots: [{ quantity: 1, pricePerBottle: 40, currency: "GBP" }],
      },
    ],
  });
  const wines = await db.wines.toArray();
  const byProducer = (p: string) => wines.find((w) => w.producer === p)!;
  return {
    margaux: byProducer("Château Margaux"),
    ridge: byProducer("Ridge"),
    loosen: byProducer("Dr. Loosen"),
    taittinger: byProducer("Taittinger"),
  };
}

describe("years with data", () => {
  beforeEach(resetDatabase);

  it("lists every year with a purchase or a drink, newest first", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2024-06-01" });

    expect(await getYearsWithData()).toEqual([2026, 2025, 2024]);
  });

  it("is empty with no purchases or drinks", async () => {
    expect(await getYearsWithData()).toEqual([]);
  });
});

describe("year in wine", () => {
  beforeEach(resetDatabase);

  it("counts bottles bought and money spent, grouped by currency, for that year only", async () => {
    await seed();
    const recap2026 = await getYearInWine(2026);
    expect(recap2026.bottlesBought).toBe(6); // Ridge (4) + Loosen (2); Margaux was bought in 2025
    expect(recap2026.spentByCurrency).toEqual([
      { currency: "USD", total: 1000 },
      { currency: "GBP", total: 40 },
    ]);

    const recap2025 = await getYearInWine(2025);
    expect(recap2025.bottlesBought).toBe(3);
    expect(recap2025.spentByCurrency).toEqual([{ currency: "GBP", total: 1500 }]);
  });

  it("excludes lots of soft-deleted wines from bottles bought and money spent", async () => {
    const { loosen } = await seed();
    await deleteWine({ wineId: loosen.id });
    const recap = await getYearInWine(2026);
    expect(recap.bottlesBought).toBe(4); // Just Ridge; Loosen's 2 bottles no longer count
    expect(recap.spentByCurrency).toEqual([{ currency: "USD", total: 1000 }]);
  });

  it("counts bottles drunk, the top wines by bottles, and colours drunk", async () => {
    const { ridge, loosen, margaux } = await seed();
    const ridgeLot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    const loosenLot = (await db.lots.where("wineId").equals(loosen.id).first())!;
    const margauxLot = (await db.lots.where("wineId").equals(margaux.id).first())!;
    await consumeBottles({ lotId: ridgeLot.id, quantity: 3, date: "2026-03-01" });
    await consumeBottles({ lotId: loosenLot.id, quantity: 2, date: "2026-03-02" });
    await consumeBottles({ lotId: margauxLot.id, quantity: 1, date: "2025-12-01" });

    const recap = await getYearInWine(2026);
    expect(recap.bottlesDrunk).toBe(5);
    expect(recap.topWines).toEqual([
      { wineId: ridge.id, label: "Ridge Monte Bello 2019", bottles: 3 },
      { wineId: loosen.id, label: "Dr. Loosen Riesling Kabinett 2021", bottles: 2 },
    ]);
    expect(recap.byColour).toEqual([
      { key: "red", label: "Red", value: 3 },
      { key: "white", label: "White", value: 2 },
    ]);

    const recap2025 = await getYearInWine(2025);
    expect(recap2025.bottlesDrunk).toBe(1);
    expect(recap2025.topWines).toEqual([
      { wineId: margaux.id, label: "Château Margaux 2015", bottles: 1 },
    ]);
  });

  it("keeps bottles bought and money spent the same after some of the lot is drunk", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    const before = await getYearInWine(2026);
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2026-03-01" });
    const after = await getYearInWine(2026);

    expect(after.bottlesBought).toBe(before.bottlesBought);
    expect(after.spentByCurrency).toEqual(before.spentByCurrency);
  });

  it("keeps bottles bought and money spent the same after part of the lot is moved", async () => {
    const { ridge } = await seed();
    await createLocation({ name: "Cellar" });
    const cellar = (await db.locations.where("name").equals("Cellar").first())!;
    const lot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    const before = await getYearInWine(2026);
    await moveBottles({ lotId: lot.id, quantity: 1, toLocationId: cellar.id });
    const after = await getYearInWine(2026);

    expect(after.bottlesBought).toBe(before.bottlesBought);
    expect(after.spentByCurrency).toEqual(before.spentByCurrency);
  });

  it("keeps a drink in its year's totals even after its wine is later deleted", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2026-03-01" });
    await deleteWine({ wineId: ridge.id });

    const recap = await getYearInWine(2026);
    expect(recap.bottlesDrunk).toBe(1);
    // The wine no longer resolves to a name or colour, so it drops out of these breakdowns.
    expect(recap.topWines).toEqual([]);
    expect(recap.byColour).toEqual([]);
  });

  it("averages the rating of tasting notes written that year, ignoring unrated ones", async () => {
    const { ridge } = await seed();
    await addTastingNote({ wineId: ridge.id, text: "Lovely", rating: 90, date: "2026-04-01" });
    await addTastingNote({ wineId: ridge.id, text: "Even better", rating: 80, date: "2026-05-01" });
    await addTastingNote({ wineId: ridge.id, text: "No score", date: "2026-06-01" });
    await addTastingNote({ wineId: ridge.id, text: "Last year", rating: 100, date: "2025-06-01" });

    expect((await getYearInWine(2026)).averageRating).toBe(85);
    expect((await getYearInWine(2027)).averageRating).toBeNull();
  });
});

describe("spending per year", () => {
  beforeEach(resetDatabase);

  it("has no data with no purchases", async () => {
    expect(await getSpendingPerYear()).toEqual({ currency: null, points: [], otherCurrencies: [] });
  });

  it("charts the currency spent the most, oldest year first, and notes other currencies", async () => {
    await seed();
    const spending = await getSpendingPerYear();
    // GBP: 1500 (2025) + 40 (2026, 2 bottles at £20) = 1540; USD: 1000 (2026). GBP wins.
    expect(spending.currency).toBe("GBP");
    expect(spending.points).toEqual([
      { key: "2025", label: "2025", value: 1500 },
      { key: "2026", label: "2026", value: 40 },
    ]);
    expect(spending.otherCurrencies).toEqual(["USD"]);
  });

  it("keeps only the most recent years, up to the limit", async () => {
    for (let year = 2018; year <= 2026; year++) {
      setClock(`${year}-01-01T09:00:00Z`);
      await addBottles({
        drafts: [
          {
            producer: `Wine ${year}`,
            vintage: year,
            colour: "red",
            lots: [
              { quantity: 1, purchaseDate: `${year}-01-01`, pricePerBottle: 10, currency: "GBP" },
            ],
          },
        ],
      });
    }
    const spending = await getSpendingPerYear(3);
    expect(spending.points.map((p) => p.key)).toEqual(["2024", "2025", "2026"]);
  });

  it("excludes lots of soft-deleted wines", async () => {
    const { ridge } = await seed();
    await deleteWine({ wineId: ridge.id });
    const spending = await getSpendingPerYear();
    expect(spending.currency).toBe("GBP");
    expect(spending.points).toEqual([
      { key: "2025", label: "2025", value: 1500 },
      { key: "2026", label: "2026", value: 40 },
    ]);
    expect(spending.otherCurrencies).toEqual([]);
  });
});
