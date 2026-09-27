import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { ConsumptionSchema, TastingNoteSchema, WishlistItemSchema } from "../../domain/types";
import { newId } from "../../lib/id";
import { runReadTool } from "./readTools";

const stamp = (at = new Date().toISOString()) => ({ id: newId(), createdAt: at, updatedAt: at });

describe("show_bottles", () => {
  beforeEach(resetDatabase);

  it("keeps the given order once per wine, counting open lots, and drops deleted or empty wines", async () => {
    const first = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const second = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    const deleted = makeWine({ producer: "Gone", deletedAt: "2026-09-01T00:00:00.000Z" });
    const empty = makeWine({ producer: "Empty" });
    await db.wines.bulkAdd([first, second, deleted, empty]);
    await db.lots.bulkAdd([
      makeLot({ wineId: first.id, quantity: 2 }),
      makeLot({ wineId: first.id, quantity: 3 }),
      makeLot({ wineId: second.id, quantity: 1 }),
      makeLot({ wineId: deleted.id, quantity: 4 }),
      makeLot({ wineId: empty.id, quantity: 0 }),
    ]);

    const outcome = await runReadTool("show_bottles", {
      wineIds: [second.id, deleted.id, first.id, empty.id, second.id],
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.wineIds).toEqual([second.id, first.id]);
    expect(JSON.parse(outcome.content)).toEqual({
      shown: [
        { wineId: second.id, wine: "Krug Grande Cuvée NV", bottles: 1 },
        { wineId: first.id, wine: "Ridge Monte Bello 2019", bottles: 5 },
      ],
    });
  });
});

describe("get_wine", () => {
  beforeEach(resetDatabase);

  it("returns the wine in full with open lots, recent drinking and tasting notes", async () => {
    const cellar = makeLocation({ name: "Cellar" });
    const wine = makeWine({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      windowFrom: 2027,
      windowTo: 2045,
      windowSource: "user",
    });
    const lot = makeLot({ wineId: wine.id, quantity: 4, locationId: cellar.id, bin: "A3" });
    await db.locations.add(cellar);
    await db.wines.add(wine);
    await db.lots.bulkAdd([lot, makeLot({ wineId: wine.id, quantity: 0 })]);
    await db.consumptions.add(
      ConsumptionSchema.parse({
        ...stamp(),
        wineId: wine.id,
        lotId: lot.id,
        date: "2026-08-01",
        quantity: 1,
        rating: 92,
        occasion: "Birthday",
      }),
    );
    await db.tastingNotes.add(
      TastingNoteSchema.parse({
        ...stamp(),
        wineId: wine.id,
        date: "2026-08-01",
        text: "Cassis and cedar.",
        rating: 92,
      }),
    );

    const outcome = await runReadTool("get_wine", { wineId: wine.id });

    expect(outcome.isError).toBe(false);
    expect(outcome.chip).toBe("Read Ridge Monte Bello 2019");
    expect(JSON.parse(outcome.content)).toMatchObject({
      wineId: wine.id,
      wine: "Ridge Monte Bello 2019",
      window: { from: 2027, to: 2045, source: "user" },
      bottles: 4,
      lots: [{ lotId: lot.id, bottles: 4, location: "Cellar", locationId: cellar.id, bin: "A3" }],
      recentlyDrunk: [{ date: "2026-08-01", bottles: 1, rating: 92, occasion: "Birthday" }],
      tastingNotes: [{ date: "2026-08-01", text: "Cassis and cedar.", rating: 92 }],
    });
  });

  it("reports an unknown or deleted wine as an error", async () => {
    const deleted = makeWine({ deletedAt: "2026-09-01T00:00:00.000Z" });
    await db.wines.add(deleted);
    for (const wineId of ["no-such-wine", deleted.id]) {
      const outcome = await runReadTool("get_wine", { wineId });
      expect(outcome).toMatchObject({ isError: true, chip: null });
      expect(outcome.content).toBe(`No wine has id ${wineId}. Search the cellar again.`);
    }
  });
});

describe("list_locations", () => {
  beforeEach(resetDatabase);

  it("lists each location with its bottles and wines, ignoring empty lots and deleted wines", async () => {
    const cellar = makeLocation({ name: "Cellar" });
    const fridge = makeLocation({ name: "Fridge" });
    const a = makeWine({ producer: "A" });
    const b = makeWine({ producer: "B" });
    const gone = makeWine({ producer: "Gone", deletedAt: "2026-09-01T00:00:00.000Z" });
    await db.locations.bulkAdd([cellar, fridge]);
    await db.wines.bulkAdd([a, b, gone]);
    await db.lots.bulkAdd([
      makeLot({ wineId: a.id, quantity: 3, locationId: cellar.id }),
      makeLot({ wineId: b.id, quantity: 2, locationId: cellar.id }),
      makeLot({ wineId: b.id, quantity: 0, locationId: fridge.id }),
      makeLot({ wineId: gone.id, quantity: 5, locationId: fridge.id }),
    ]);

    const outcome = await runReadTool("list_locations", {});

    expect(outcome).toMatchObject({ isError: false, chip: "Listed 2 locations" });
    const { locations } = JSON.parse(outcome.content) as { locations: { name: string }[] };
    expect(locations).toHaveLength(2);
    expect(locations).toEqual(
      expect.arrayContaining([
        { locationId: cellar.id, name: "Cellar", bottles: 5, wines: 2 },
        { locationId: fridge.id, name: "Fridge", bottles: 0, wines: 0 },
      ]),
    );
  });
});

describe("get_consumption_history", () => {
  beforeEach(resetDatabase);

  async function drink(wineId: string, date: string, occasion: string | null = null) {
    await db.consumptions.add(
      ConsumptionSchema.parse({ ...stamp(), wineId, date, quantity: 1, occasion }),
    );
  }

  it("lists drinking newest first, filtered by wine and limited, with the full total", async () => {
    const ridge = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const krug = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    await db.wines.bulkAdd([ridge, krug]);
    await drink(ridge.id, "2026-01-10");
    await drink(krug.id, "2026-03-05", "Anniversary");
    await drink(ridge.id, "2026-06-20", "Dinner");
    await drink("wine-since-purged", "2025-12-31");

    const all = await runReadTool("get_consumption_history", { limit: 3 });
    expect(all).toMatchObject({ isError: false, chip: "Checked drinking history: 4 entries" });
    const parsed = JSON.parse(all.content) as { total: number; entries: unknown[] };
    expect(parsed.total).toBe(4);
    expect(parsed.entries).toEqual([
      {
        date: "2026-06-20",
        wineId: ridge.id,
        wine: "Ridge Monte Bello 2019",
        bottles: 1,
        rating: null,
        occasion: "Dinner",
      },
      {
        date: "2026-03-05",
        wineId: krug.id,
        wine: "Krug Grande Cuvée NV",
        bottles: 1,
        rating: null,
        occasion: "Anniversary",
      },
      {
        date: "2026-01-10",
        wineId: ridge.id,
        wine: "Ridge Monte Bello 2019",
        bottles: 1,
        rating: null,
        occasion: null,
      },
    ]);

    const oneWine = await runReadTool("get_consumption_history", { wineId: ridge.id });
    const filtered = JSON.parse(oneWine.content) as { total: number; entries: { date: string }[] };
    expect(filtered.total).toBe(2);
    expect(filtered.entries.map((e) => e.date)).toEqual(["2026-06-20", "2026-01-10"]);

    const orphan = await runReadTool("get_consumption_history", { wineId: "wine-since-purged" });
    expect(JSON.parse(orphan.content)).toMatchObject({ entries: [{ wine: "Unknown wine" }] });
  });
});

describe("list_wishlist", () => {
  beforeEach(resetDatabase);

  it("lists wishlist items newest first with label, colour, target price and note", async () => {
    await db.wishlist.bulkAdd([
      WishlistItemSchema.parse({
        ...stamp("2026-05-01T10:00:00.000Z"),
        producer: "Keller",
        name: "G-Max",
        vintage: 2021,
        colour: "white",
        targetPrice: 450,
        currency: "EUR",
        notes: "Only from the estate",
      }),
      WishlistItemSchema.parse({
        ...stamp("2026-07-01T10:00:00.000Z"),
        producer: "Bollinger",
      }),
    ]);
    const [newest, oldest] = await db.wishlist.orderBy("createdAt").reverse().toArray();

    const outcome = await runReadTool("list_wishlist", {});

    expect(outcome).toMatchObject({ isError: false, chip: "Read wishlist: 2 items", wineIds: [] });
    expect(JSON.parse(outcome.content)).toEqual({
      items: [
        {
          itemId: newest?.id,
          wine: "Bollinger NV",
          colour: null,
          country: null,
          region: null,
          targetPrice: null,
          currency: null,
          note: null,
        },
        {
          itemId: oldest?.id,
          wine: "Keller G-Max 2021",
          colour: "white",
          country: null,
          region: null,
          targetPrice: 450,
          currency: "EUR",
          note: "Only from the estate",
        },
      ],
    });
  });

  it("says so when the wishlist is empty", async () => {
    const outcome = await runReadTool("list_wishlist", {});
    expect(outcome).toMatchObject({ isError: false, chip: "Read wishlist: 0 items" });
    expect(JSON.parse(outcome.content)).toEqual({ items: [] });
  });
});

describe("runReadTool errors", () => {
  beforeEach(resetDatabase);

  it("refuses invalid input with the field and reason, without running the tool", async () => {
    const outcome = await runReadTool("get_consumption_history", { limit: 0 });
    expect(outcome).toEqual({
      content: expect.stringMatching(/^Invalid input for get_consumption_history: limit /),
      isError: true,
      chip: null,
      wineIds: [],
    });
    const missing = await runReadTool("get_wine", {});
    expect(missing.content).toMatch(/^Invalid input for get_wine: wineId /);
  });

  it("turns a thrown error into a failed tool result instead of throwing", async () => {
    const spy = vi.spyOn(db.consumptions, "toArray").mockRejectedValue(new Error("disk gone"));
    const outcome = await runReadTool("get_consumption_history", {});
    spy.mockRestore();
    expect(outcome).toEqual({
      content: "The tool failed: disk gone",
      isError: true,
      chip: null,
      wineIds: [],
    });
  });
});
