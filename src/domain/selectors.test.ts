import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { resetDatabase } from "../db/testing";
import { setClock } from "./clock";
import { consumeBottles } from "./commands/consumption";
import { createLocation } from "./commands/locations";
import { addTastingNote } from "./commands/notes";
import { addBottles, deleteWine, updateWine } from "./commands/wines";
import { addWishlistItem } from "./commands/wishlist";
import {
  getCellarList,
  getFilterOptions,
  getHistory,
  getHomeSections,
  getLocationsWithCounts,
  getRecentlyDeleted,
  getStats,
  getWineDetail,
  getWishlist,
  useCellarList,
  WINE_HISTORY_LIMIT,
} from "./selectors";

const YEAR = 2026;

async function seed() {
  setClock("2026-09-01T09:00:00Z");
  await createLocation({ name: "Kitchen rack" });
  await createLocation({ name: "EuroCave A" });
  const kitchen = (await db.locations.where("name").equals("Kitchen rack").first())!;
  const cave = (await db.locations.where("name").equals("EuroCave A").first())!;
  await addBottles({
    drafts: [
      {
        producer: "Château Margaux",
        vintage: 2015,
        colour: "red",
        country: "France",
        region: "Bordeaux",
        grapes: ["Cabernet Sauvignon"],
        windowFrom: 2028,
        windowTo: 2060,
        lots: [{ quantity: 3, locationId: cave.id, pricePerBottle: 500, currency: "GBP" }],
      },
    ],
  });
  setClock("2026-09-02T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        country: "USA",
        region: "Santa Cruz Mountains",
        windowFrom: 2022,
        windowTo: 2030,
        lots: [
          { quantity: 4, locationId: kitchen.id, pricePerBottle: 250, currency: "USD" },
          { quantity: 2, locationId: cave.id, pricePerBottle: 240, currency: "USD" },
        ],
      },
    ],
  });
  setClock("2026-09-03T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Dr. Loosen",
        name: "Riesling Kabinett",
        vintage: 2021,
        colour: "white",
        country: "Germany",
        region: "Mosel",
        grapes: ["Riesling"],
        windowFrom: 2022,
        windowTo: 2027,
        lots: [{ quantity: 2, locationId: kitchen.id, pricePerBottle: 20, currency: "GBP" }],
      },
    ],
  });
  setClock("2026-09-04T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Taittinger",
        name: "Brut Réserve",
        vintage: null,
        colour: "sparkling",
        country: "France",
        region: "Champagne",
        windowFrom: 2018,
        windowTo: 2024,
        lots: [{ quantity: 1, locationId: kitchen.id }],
      },
    ],
  });
  setClock("2026-09-05T09:00:00Z");
  await addBottles({
    drafts: [
      { producer: "Unknown Estate", vintage: 2020, colour: "rose", lots: [{ quantity: 1 }] },
    ],
  });
  const wines = await db.wines.toArray();
  const byProducer = (p: string) => wines.find((w) => w.producer === p)!;
  return {
    kitchen,
    cave,
    margaux: byProducer("Château Margaux"),
    ridge: byProducer("Ridge"),
    loosen: byProducer("Dr. Loosen"),
    taittinger: byProducer("Taittinger"),
    rose: byProducer("Unknown Estate"),
  };
}

const producers = (rows: { wine: { producer: string } }[]) => rows.map((r) => r.wine.producer);

describe("cellar list", () => {
  beforeEach(resetDatabase);

  it("returns in-cellar wines with bottle counts, status and location names", async () => {
    const { ridge } = await seed();
    const rows = await getCellarList({}, YEAR);
    expect(rows).toHaveLength(5);
    const ridgeRow = rows.find((r) => r.wine.id === ridge.id);
    expect(ridgeRow).toMatchObject({ bottles: 6, openLots: 2, status: "ready" });
    expect(ridgeRow?.locationNames.sort()).toEqual(["EuroCave A", "Kitchen rack"]);
  });

  it("searches producer, name, region and grapes, ignoring accents and case", async () => {
    await seed();
    expect(producers(await getCellarList({ search: "chateau" }, YEAR))).toEqual([
      "Château Margaux",
    ]);
    expect(producers(await getCellarList({ search: "monte" }, YEAR))).toEqual(["Ridge"]);
    expect(producers(await getCellarList({ search: "mosel" }, YEAR))).toEqual(["Dr. Loosen"]);
    expect(producers(await getCellarList({ search: "cabernet" }, YEAR))).toEqual([
      "Château Margaux",
    ]);
    expect(producers(await getCellarList({ search: "ridge 2019" }, YEAR))).toEqual(["Ridge"]);
    expect(await getCellarList({ search: "zinfandel" }, YEAR)).toEqual([]);
  });

  it("filters by colour, status, location and country", async () => {
    const { kitchen } = await seed();
    expect(producers(await getCellarList({ colours: ["white"] }, YEAR))).toEqual(["Dr. Loosen"]);
    expect(producers(await getCellarList({ statuses: ["past-peak"] }, YEAR))).toEqual([
      "Taittinger",
    ]);
    expect(producers(await getCellarList({ statuses: ["hold"] }, YEAR))).toEqual([
      "Château Margaux",
    ]);
    expect(producers(await getCellarList({ countries: ["France"], sort: "name" }, YEAR))).toEqual([
      "Château Margaux",
      "Taittinger",
    ]);
    expect(
      producers(await getCellarList({ locationIds: [kitchen.id], sort: "name" }, YEAR)),
    ).toEqual(["Dr. Loosen", "Ridge", "Taittinger"]);
  });

  it("sorts by name, vintage, window and recent", async () => {
    await seed();
    expect(producers(await getCellarList({ sort: "name" }, YEAR))).toEqual([
      "Château Margaux",
      "Dr. Loosen",
      "Ridge",
      "Taittinger",
      "Unknown Estate",
    ]);
    // Oldest vintage first, non-vintage last.
    expect(producers(await getCellarList({ sort: "vintage" }, YEAR))).toEqual([
      "Château Margaux",
      "Ridge",
      "Unknown Estate",
      "Dr. Loosen",
      "Taittinger",
    ]);
    expect(producers(await getCellarList({ sort: "window" }, YEAR))).toEqual([
      "Taittinger",
      "Dr. Loosen",
      "Ridge",
      "Château Margaux",
      "Unknown Estate",
    ]);
    expect(producers(await getCellarList({ sort: "recent" }, YEAR))[0]).toBe("Unknown Estate");
  });

  it("hides deleted wines and shows drunk wines only when asked", async () => {
    const { taittinger, rose } = await seed();
    const lot = (await db.lots.where("wineId").equals(taittinger.id).first())!;
    await consumeBottles({ lotId: lot.id });
    await deleteWine({ wineId: rose.id });
    expect(producers(await getCellarList({}, YEAR))).not.toContain("Taittinger");
    expect(producers(await getCellarList({ drunkOnly: true }, YEAR))).toEqual(["Taittinger"]);
    const all = producers(await getCellarList({ includeDrunk: true }, YEAR));
    expect(all).toContain("Taittinger");
    expect(all).not.toContain("Unknown Estate");
  });

  it("offers the countries and regions in use for filters", async () => {
    await seed();
    const options = await getFilterOptions();
    expect(options.countries).toEqual(["France", "Germany", "USA"]);
    expect(options.regions).toContain("Mosel");
  });

  it("updates live through the hook", async () => {
    await seed();
    const { result } = renderHook(() => useCellarList({ colours: ["rose"] }));
    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});

describe("wine detail", () => {
  beforeEach(resetDatabase);

  it("returns the wine, open lots with location names, consumptions, notes and history", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where("wineId").equals(ridge.id).first())!;
    await consumeBottles({ lotId: lot.id, note: "Great", date: "2026-09-10", rating: 95 });
    await addTastingNote({ wineId: ridge.id, text: "Second look" });

    const detail = await getWineDetail(ridge.id, YEAR);
    expect(detail?.wine.id).toBe(ridge.id);
    expect(detail?.status).toBe("ready");
    expect(detail?.bottles).toBe(5);
    expect(detail?.lots.map((l) => l.locationName).sort()).toEqual(["EuroCave A", "Kitchen rack"]);
    expect(detail?.consumptions).toHaveLength(1);
    expect(detail?.notes.map((n) => n.text).sort()).toEqual(["Great", "Second look"]);
    expect(detail?.history.map((b) => b.command)).toEqual([
      "addTastingNote",
      "consumeBottles",
      "addBottles",
    ]);
  });

  it("keeps only the newest batches for this wine, newest first, up to the limit", async () => {
    const { ridge, rose } = await seed();
    const total = WINE_HISTORY_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      setClock(new Date(Date.UTC(2026, 8, 10, 0, i)).toISOString());
      await addTastingNote({ wineId: ridge.id, text: `Note ${i}` });
      await addTastingNote({ wineId: rose.id, text: `Other ${i}` });
    }

    const history = (await getWineDetail(ridge.id, YEAR))?.history ?? [];
    expect(history).toHaveLength(WINE_HISTORY_LIMIT);
    expect(history.every((b) => b.summary.includes("Ridge"))).toBe(true);
    const times = history.map((b) => b.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(times[0]?.slice(0, 16)).toBe(`2026-09-10T00:${total - 1}`);
  });

  it("returns undefined for a missing or deleted wine", async () => {
    const { rose } = await seed();
    expect(await getWineDetail("missing")).toBeUndefined();
    await deleteWine({ wineId: rose.id });
    expect(await getWineDetail(rose.id)).toBeUndefined();
  });
});

describe("home sections", () => {
  beforeEach(resetDatabase);

  it("groups by window status, lists recent additions, counts, and cost per currency", async () => {
    await seed();
    const home = await getHomeSections(YEAR);
    expect(producers(home.ready)).toEqual(["Ridge"]);
    expect(producers(home.drinkSoon)).toEqual(["Dr. Loosen"]);
    expect(producers(home.pastPeak)).toEqual(["Taittinger"]);
    expect(producers(home.recentlyAdded)[0]).toBe("Unknown Estate");
    expect(home.counts).toMatchObject({ wines: 5, bottles: 13 });
    expect(home.counts.byStatus).toEqual({
      hold: 1,
      ready: 1,
      "drink-soon": 1,
      "past-peak": 1,
      none: 1,
    });
    // Cost is grouped by currency and never summed across currencies.
    expect(home.costByCurrency).toEqual([
      { currency: "GBP", total: 1540 },
      { currency: "USD", total: 1480 },
    ]);
    expect(home.sampleLoaded).toBe(false);
    expect(home.isEmpty).toBe(false);
  });

  it("totals the collector's values per currency, counting only wines in the cellar with a value", async () => {
    const wine = (producer: string, quantity: number) => ({
      producer,
      vintage: 2019,
      colour: "red" as const,
      lots: [{ quantity }],
    });
    await addBottles({
      drafts: [wine("Ridge", 3), wine("Latour", 2), wine("Loosen", 4), wine("Drunk Estate", 1)],
    });
    const byProducer = new Map((await db.wines.toArray()).map((w) => [w.producer, w.id]));
    const setValue = (producer: string, valuePerBottle: number, valueCurrency: string) =>
      updateWine({ wineId: byProducer.get(producer)!, patch: { valuePerBottle, valueCurrency } });
    await setValue("Ridge", 250, "USD");
    await setValue("Latour", 600.5, "GBP");
    await setValue("Drunk Estate", 1000, "GBP");
    await db.lots.where("wineId").equals(byProducer.get("Drunk Estate")!).modify({ quantity: 0 });
    // A row saved before values existed has no value fields at all.
    await db.wines.update(byProducer.get("Loosen")!, (row) => {
      delete (row as Partial<typeof row>).valuePerBottle;
      delete (row as Partial<typeof row>).valueCurrency;
      delete (row as Partial<typeof row>).valueUpdatedAt;
    });

    const home = await getHomeSections(YEAR);
    expect(home.valueByCurrency).toEqual([
      { currency: "GBP", total: 1201 },
      { currency: "USD", total: 750 },
    ]);
    expect(home.valuedWines).toBe(2);
    expect(home.counts.wines).toBe(3);
  });

  it("has no value totals when no wine has a value", async () => {
    await seed();
    const home = await getHomeSections(YEAR);
    expect(home.valueByCurrency).toEqual([]);
    expect(home.valuedWines).toBe(0);
  });

  it("counts open lots only for wines still in the cellar", async () => {
    // Ridge over two lots, Latour untouched, and a fully-drunk wine whose closed lot must not
    // count: a regression guard for computing this with a Set lookup instead of a nested scan.
    await addBottles({
      drafts: [
        {
          producer: "Ridge",
          vintage: 2019,
          colour: "red" as const,
          lots: [{ quantity: 3 }, { quantity: 2 }],
        },
        { producer: "Latour", vintage: 2015, colour: "red" as const, lots: [{ quantity: 1 }] },
        {
          producer: "Drunk Estate",
          vintage: 2010,
          colour: "red" as const,
          lots: [{ quantity: 1 }],
        },
      ],
    });
    const drunkEstate = (await db.wines.where("producer").equals("Drunk Estate").first())!;
    await db.lots.where("wineId").equals(drunkEstate.id).modify({ quantity: 0 });

    const home = await getHomeSections(YEAR);
    expect(home.counts.wines).toBe(2);
    expect(home.counts.openLots).toBe(3);
  });

  it("lists wines coming into their window this year or next", async () => {
    await seed();
    const home = await getHomeSections(2027);
    expect(producers(home.comingIntoWindow)).toEqual(["Château Margaux"]);
  });

  it("does not repeat a wine whose window opens this year, since it is already ready", async () => {
    await seed();
    const home = await getHomeSections(2028);
    expect(producers(home.ready)).toContain("Château Margaux");
    expect(producers(home.comingIntoWindow)).not.toContain("Château Margaux");
  });
});

describe("stats", () => {
  beforeEach(resetDatabase);

  it("builds bottle series by colour, country, vintage decade, status and drinks per month", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where({ wineId: ridge.id, quantity: 4 }).first())!;
    await consumeBottles({ lotId: lot.id, quantity: 2, date: "2026-08-15" });
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2025-01-15" });

    const stats = await getStats(YEAR, new Date("2026-09-26T12:00:00Z"));
    expect(stats.byColour).toContainEqual({ key: "red", label: "Red", value: 6 });
    expect(stats.byCountry[0]).toEqual({ key: "France", label: "France", value: 4 });
    expect(stats.byVintageDecade).toContainEqual({ key: "2010s", label: "2010s", value: 6 });
    expect(stats.byVintageDecade).toContainEqual({ key: "nv", label: "NV", value: 1 });
    expect(stats.byStatus).toContainEqual({ key: "ready", label: "Ready", value: 3 });
    expect(stats.drunkPerMonth).toHaveLength(12);
    expect(stats.drunkPerMonth[11]).toMatchObject({ key: "2026-09", value: 0 });
    expect(stats.drunkPerMonth[10]).toMatchObject({ key: "2026-08", value: 2 });
    expect(stats.drunkPerMonth.reduce((s, p) => s + p.value, 0)).toBe(2);
  });

  it("counts drinks from the first day of the twelve-month window", async () => {
    const { ridge } = await seed();
    const lot = (await db.lots.where({ wineId: ridge.id, quantity: 4 }).first())!;
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2025-10-01" });
    await consumeBottles({ lotId: lot.id, quantity: 1, date: "2025-09-30" });

    const stats = await getStats(YEAR, new Date("2026-09-26T12:00:00Z"));
    expect(stats.drunkPerMonth[0]).toMatchObject({ key: "2025-10", value: 1 });
    expect(stats.drunkPerMonth.reduce((s, p) => s + p.value, 0)).toBe(1);
  });
});

describe("history, recently deleted, locations and wishlist", () => {
  beforeEach(resetDatabase);

  it("lists batches newest first", async () => {
    await seed();
    const history = await getHistory();
    expect(history[0]?.summary).toBe("Added 1 bottle of Unknown Estate 2020");
    expect(history.at(-1)?.summary).toBe("Created location Kitchen rack");
  });

  it("lists wines deleted in the last 30 days with their purge date", async () => {
    const { rose } = await seed();
    setClock("2026-09-10T09:00:00Z");
    await deleteWine({ wineId: rose.id });
    const deleted = await getRecentlyDeleted();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ wine: { id: rose.id }, purgeOn: "2026-10-10" });
  });

  it("counts bottles per location", async () => {
    await seed();
    const locations = await getLocationsWithCounts();
    expect(locations.map((l) => [l.location.name, l.bottles, l.wines])).toEqual([
      ["EuroCave A", 5, 2],
      ["Kitchen rack", 7, 3],
    ]);
  });

  it("counts bottles of deleted wines separately, so a location is not shown as empty", async () => {
    const { taittinger } = await seed();
    await deleteWine({ wineId: taittinger.id }); // its 1 bottle is in the kitchen rack
    const locations = await getLocationsWithCounts();
    expect(locations.map((l) => [l.location.name, l.bottles, l.wines, l.deletedBottles])).toEqual([
      ["EuroCave A", 5, 2, 0],
      ["Kitchen rack", 6, 2, 1],
    ]);
  });

  it("lists wishlist items newest first", async () => {
    setClock("2026-09-01T09:00:00Z");
    await addWishlistItem({ producer: "Krug" });
    setClock("2026-09-02T09:00:00Z");
    await addWishlistItem({ producer: "Salon" });
    expect((await getWishlist()).map((i) => i.producer)).toEqual(["Salon", "Krug"]);
  });
});
