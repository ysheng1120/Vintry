import { describe, expect, it } from "vitest";
import { makeLot, makeWine } from "../../db/testing";
import { compareBinNames, countLots, filterBinGroups, groupLotsByBin } from "./bins";

describe("compareBinNames", () => {
  it("sorts natural numbers instead of characters", () => {
    const names = ["A10", "A2", "A1"].sort(compareBinNames);
    expect(names).toEqual(["A1", "A2", "A10"]);
  });

  it("sorts a bare letter before a numbered one", () => {
    expect(["A2", "A"].sort(compareBinNames)).toEqual(["A", "A2"]);
  });

  it("falls back to plain text comparison", () => {
    expect(["Top shelf", "Back row"].sort(compareBinNames)).toEqual(["Back row", "Top shelf"]);
  });
});

describe("groupLotsByBin", () => {
  it("groups by bin, sorted naturally, with a per-bin total", () => {
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const wines = new Map([[wine.id, wine]]);
    const lots = [
      makeLot({ wineId: wine.id, bin: "A10", quantity: 2 }),
      makeLot({ wineId: wine.id, bin: "A2", quantity: 3 }),
      makeLot({ wineId: wine.id, bin: "A2", quantity: 1 }),
    ];

    const groups = groupLotsByBin(lots, wines);

    expect(groups.map((g) => g.bin)).toEqual(["A2", "A10"]);
    expect(groups[0]).toMatchObject({ bin: "A2", bottles: 4 });
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[1]).toMatchObject({ bin: "A10", bottles: 2 });
  });

  it("puts lots with no bin in a final null group", () => {
    const wine = makeWine();
    const wines = new Map([[wine.id, wine]]);
    const lots = [
      makeLot({ wineId: wine.id, bin: "A1", quantity: 1 }),
      makeLot({ wineId: wine.id, bin: null, quantity: 2 }),
    ];

    const groups = groupLotsByBin(lots, wines);

    expect(groups.map((g) => g.bin)).toEqual(["A1", null]);
  });

  it("treats a blank bin the same as no bin", () => {
    const wine = makeWine();
    const wines = new Map([[wine.id, wine]]);
    const lots = [makeLot({ wineId: wine.id, bin: "  ", quantity: 1 })];

    expect(groupLotsByBin(lots, wines).map((g) => g.bin)).toEqual([null]);
  });

  it("carries the wine label (with vintage) and skips lots for wines it isn't given", () => {
    const wine = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    const wines = new Map([[wine.id, wine]]);
    const lots = [
      makeLot({ wineId: wine.id, bin: "A1", quantity: 2 }),
      makeLot({ wineId: "missing-wine", bin: "A1", quantity: 5 }),
    ];

    const groups = groupLotsByBin(lots, wines);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toEqual([
      {
        lotId: lots[0]?.id,
        wineId: wine.id,
        label: "Krug Grande Cuvée NV",
        vintage: null,
        quantity: 2,
      },
    ]);
  });

  it("sorts bottles within a bin by label", () => {
    const zin = makeWine({ producer: "Zinfandel Co" });
    const abbey = makeWine({ producer: "Abbey Estate" });
    const wines = new Map([
      [zin.id, zin],
      [abbey.id, abbey],
    ]);
    const lots = [
      makeLot({ wineId: zin.id, bin: "A1", quantity: 1 }),
      makeLot({ wineId: abbey.id, bin: "A1", quantity: 1 }),
    ];

    const groups = groupLotsByBin(lots, wines);

    expect(groups[0]?.rows.map((r) => r.wineId)).toEqual([abbey.id, zin.id]);
  });
});

describe("filterBinGroups", () => {
  const wineA = makeWine({ producer: "Ridge", name: "Monte Bello" });
  const wineB = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
  const wines = new Map([
    [wineA.id, wineA],
    [wineB.id, wineB],
  ]);
  const groups = groupLotsByBin(
    [
      makeLot({ wineId: wineA.id, bin: "A1", quantity: 2 }),
      makeLot({ wineId: wineB.id, bin: "A1", quantity: 1 }),
    ],
    wines,
  );

  it("returns every group unchanged for a blank query", () => {
    expect(filterBinGroups(groups, "  ")).toEqual(groups);
  });

  it("keeps only matching bottles and recomputes bin totals", () => {
    const filtered = filterBinGroups(groups, "ridge");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ bin: "A1", bottles: 2 });
    expect(filtered[0]?.rows).toHaveLength(1);
  });

  it("matches case-insensitively and drops bins left empty", () => {
    expect(filterBinGroups(groups, "KRUG").map((g) => g.rows.length)).toEqual([1]);
    expect(filterBinGroups(groups, "no such wine")).toEqual([]);
  });
});

describe("countLots", () => {
  it("sums lots across every bin", () => {
    const wine = makeWine();
    const wines = new Map([[wine.id, wine]]);
    const groups = groupLotsByBin(
      [
        makeLot({ wineId: wine.id, bin: "A1", quantity: 1 }),
        makeLot({ wineId: wine.id, bin: "A2", quantity: 1 }),
        makeLot({ wineId: wine.id, bin: null, quantity: 1 }),
      ],
      wines,
    );
    expect(countLots(groups)).toBe(3);
  });
});
