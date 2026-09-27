import { describe, expect, it } from "vitest";
import { makeWine } from "../db/testing";
import { newId } from "../lib/id";
import {
  computeTasteProfile,
  FAVOURITES_LIMIT,
  MIN_RATED_FOR_FAVOURITE,
  MIN_RATED_FOR_PROFILE,
} from "./taste";
import { ConsumptionSchema, TastingNoteSchema, type Consumption, type TastingNote } from "./types";

function makeNote(overrides: Partial<TastingNote> & { wineId: string }): TastingNote {
  const t = new Date().toISOString();
  return TastingNoteSchema.parse({
    id: newId(),
    createdAt: t,
    updatedAt: t,
    date: "2026-01-01",
    text: "Lovely",
    ...overrides,
  });
}

function makeConsumption(overrides: Partial<Consumption> & { wineId: string }): Consumption {
  const t = new Date().toISOString();
  return ConsumptionSchema.parse({
    id: newId(),
    createdAt: t,
    updatedAt: t,
    date: "2026-01-01",
    quantity: 1,
    ...overrides,
  });
}

describe("computeTasteProfile", () => {
  it("says there is no data with an empty cellar", () => {
    const profile = computeTasteProfile([], [], []);
    expect(profile).toEqual({
      ratedWines: 0,
      averageRating: null,
      enoughData: false,
      colours: [],
      countries: [],
      regions: [],
      grapes: [],
      vintageDecades: [],
    });
  });

  it("counts a wine's own rating, its best tasting note, or its best drink, whichever is highest", () => {
    const ownRated = makeWine({ rating: 90 });
    const noted = makeWine({ rating: null });
    const drunk = makeWine({ rating: null });
    const notes = [
      makeNote({ wineId: noted.id, rating: 80 }),
      makeNote({ wineId: noted.id, rating: 94 }),
    ];
    const consumptions = [makeConsumption({ wineId: drunk.id, rating: 88 })];

    const profile = computeTasteProfile([ownRated, noted, drunk], notes, consumptions);

    expect(profile.ratedWines).toBe(3);
    expect(profile.averageRating).toBeCloseTo((90 + 94 + 88) / 3, 1);
  });

  it("excludes wines with no rating anywhere", () => {
    const unrated = makeWine({ rating: null });
    const notedButNull = makeWine({ rating: null });
    const notes = [makeNote({ wineId: notedButNull.id, rating: null })];

    const profile = computeTasteProfile([unrated, notedButNull], notes, []);

    expect(profile.ratedWines).toBe(0);
    expect(profile.averageRating).toBeNull();
  });

  it("excludes sample and deleted wines even when rated", () => {
    const sample = makeWine({ rating: 95, isSample: true });
    const deleted = makeWine({ rating: 95, deletedAt: "2026-01-01T00:00:00.000Z" });

    const profile = computeTasteProfile([sample, deleted], [], []);

    expect(profile.ratedWines).toBe(0);
  });

  it("needs at least MIN_RATED_FOR_FAVOURITE rated wines to call a group a favourite", () => {
    expect(MIN_RATED_FOR_FAVOURITE).toBe(2);
    const onlyOne = makeWine({ colour: "red", country: "France", rating: 95 });

    const profile = computeTasteProfile([onlyOne], [], []);

    expect(profile.colours).toEqual([]);
    expect(profile.countries).toEqual([]);
  });

  it("groups by colour, country and region, with count and average rating", () => {
    const wines = [
      makeWine({ colour: "red", country: "France", region: "Burgundy", rating: 90 }),
      makeWine({ colour: "red", country: "France", region: "Burgundy", rating: 100 }),
      makeWine({ colour: "white", country: "France", region: "Alsace", rating: 80 }),
      makeWine({ colour: "white", country: "Germany", region: "Mosel", rating: 82 }),
    ];

    const profile = computeTasteProfile(wines, [], []);

    expect(profile.colours).toEqual([
      { key: "red", label: "Red", count: 2, averageRating: 95 },
      { key: "white", label: "White", count: 2, averageRating: 81 },
    ]);
    expect(profile.countries).toEqual([
      { key: "France", label: "France", count: 3, averageRating: 90 },
    ]);
    expect(profile.regions).toEqual([
      { key: "Burgundy", label: "Burgundy", count: 2, averageRating: 95 },
    ]);
  });

  it("counts a wine towards every grape it lists", () => {
    const blend = makeWine({ grapes: ["Grenache", "Syrah"], rating: 92 });
    const otherGrenache = makeWine({ grapes: ["Grenache"], rating: 88 });
    const soloSyrah = makeWine({ grapes: ["Syrah"], rating: 70 });

    const profile = computeTasteProfile([blend, otherGrenache, soloSyrah], [], []);

    expect(profile.grapes).toEqual(
      expect.arrayContaining([
        { key: "Grenache", label: "Grenache", count: 2, averageRating: 90 },
        { key: "Syrah", label: "Syrah", count: 2, averageRating: 81 },
      ]),
    );
  });

  it("groups by vintage decade, folding non-vintage wines under NV", () => {
    const wines = [
      makeWine({ vintage: 2015, rating: 90 }),
      makeWine({ vintage: 2018, rating: 94 }),
      makeWine({ vintage: null, rating: 85 }),
      makeWine({ vintage: null, rating: 89 }),
    ];

    const profile = computeTasteProfile(wines, [], []);

    expect(profile.vintageDecades).toEqual(
      expect.arrayContaining([
        { key: "2010s", label: "2010s", count: 2, averageRating: 92 },
        { key: "nv", label: "NV", count: 2, averageRating: 87 },
      ]),
    );
  });

  it("sorts favourites by average rating, then by count, then by name, capped at the limit", () => {
    const wines = Array.from({ length: FAVOURITES_LIMIT + 2 }, (_, i) =>
      makeWine({ country: `Country ${i}`, rating: 80 + i }),
    ).flatMap((wine) => [wine, makeWine({ country: wine.country, rating: wine.rating })]);

    const profile = computeTasteProfile(wines, [], []);

    expect(profile.countries).toHaveLength(FAVOURITES_LIMIT);
    const averages = profile.countries.map((c) => c.averageRating);
    expect(averages).toEqual([...averages].sort((a, b) => b - a));
  });

  it("says there is enough data only once MIN_RATED_FOR_PROFILE wines are rated", () => {
    expect(MIN_RATED_FOR_PROFILE).toBe(5);
    const fourRated = Array.from({ length: 4 }, () => makeWine({ rating: 90 }));
    expect(computeTasteProfile(fourRated, [], []).enoughData).toBe(false);

    const fiveRated = Array.from({ length: 5 }, () => makeWine({ rating: 90 }));
    expect(computeTasteProfile(fiveRated, [], []).enoughData).toBe(true);
  });
});
