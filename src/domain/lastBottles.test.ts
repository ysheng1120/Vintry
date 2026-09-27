import { describe, expect, it } from "vitest";
import { makeLot, makeWine } from "../db/testing";
import { newId } from "../lib/id";
import { LAST_BOTTLES_LIMIT, RATED_WELL_THRESHOLD, selectLastBottles } from "./lastBottles";
import { TastingNoteSchema, type TastingNote, type Wine } from "./types";

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

const oneBottle = (wine: Wine) => [makeLot({ wineId: wine.id, quantity: 1 })];

describe("selectLastBottles", () => {
  it("includes a wine whose own rating is at least the threshold, down to one bottle", () => {
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", rating: 92 });
    const rows = selectLastBottles([wine], oneBottle(wine), []);
    expect(rows).toEqual([{ wine, rating: 92 }]);
  });

  it("uses the best tasting-note rating when the wine itself has no rating", () => {
    const wine = makeWine({ producer: "Krug", rating: null });
    const notes = [
      makeNote({ wineId: wine.id, rating: 85 }),
      makeNote({ wineId: wine.id, rating: 94 }),
    ];
    const rows = selectLastBottles([wine], oneBottle(wine), notes);
    expect(rows).toEqual([{ wine, rating: 94 }]);
  });

  it("counts four stars (80 points) as rated well", () => {
    expect(RATED_WELL_THRESHOLD).toBe(80);
  });

  it("excludes a wine rated below the threshold", () => {
    const wine = makeWine({ rating: RATED_WELL_THRESHOLD - 1 });
    expect(selectLastBottles([wine], oneBottle(wine), [])).toEqual([]);
  });

  it("excludes a wine with no rating at all", () => {
    const wine = makeWine({ rating: null });
    expect(
      selectLastBottles([wine], oneBottle(wine), [makeNote({ wineId: wine.id, rating: null })]),
    ).toEqual([]);
  });

  it("excludes a wine with more than one bottle left", () => {
    const wine = makeWine({ rating: 95 });
    const lots = [makeLot({ wineId: wine.id, quantity: 2 })];
    expect(selectLastBottles([wine], lots, [])).toEqual([]);
  });

  it("counts bottles across lots, and skips a wine with none left", () => {
    const wine = makeWine({ rating: 95 });
    const twoLotsOfOne = [
      makeLot({ wineId: wine.id, quantity: 1 }),
      makeLot({ wineId: wine.id, quantity: 1 }),
    ];
    expect(selectLastBottles([wine], twoLotsOfOne, [])).toEqual([]);

    const drunkOut = [makeLot({ wineId: wine.id, quantity: 0 })];
    expect(selectLastBottles([wine], drunkOut, [])).toEqual([]);
  });

  it("excludes sample and deleted wines", () => {
    const sample = makeWine({ rating: 95, isSample: true });
    const deleted = makeWine({ rating: 95, deletedAt: "2026-01-01T00:00:00.000Z" });
    const lots = [...oneBottle(sample), ...oneBottle(deleted)];
    expect(selectLastBottles([sample, deleted], lots, [])).toEqual([]);
  });

  it("sorts best-rated first, then by name, and caps at the limit", () => {
    const wines = Array.from({ length: LAST_BOTTLES_LIMIT + 2 }, (_, i) =>
      makeWine({ producer: `Estate ${i}`, rating: 90 + (i % 3) }),
    );
    const lots = wines.flatMap(oneBottle);
    const rows = selectLastBottles(wines, lots, []);
    expect(rows).toHaveLength(LAST_BOTTLES_LIMIT);
    const ratings = rows.map((r) => r.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it("breaks a rating tie by name", () => {
    const b = makeWine({ producer: "Beaucastel", rating: 92 });
    const a = makeWine({ producer: "Antinori", rating: 92 });
    const lots = [...oneBottle(a), ...oneBottle(b)];
    const rows = selectLastBottles([b, a], lots, []);
    expect(rows.map((r) => r.wine.producer)).toEqual(["Antinori", "Beaucastel"]);
  });
});
