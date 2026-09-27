import { describe, expect, it } from "vitest";
import { makeWine } from "../../db/testing";
import type { CellarRow } from "../../domain/selectors";
import { matchesQuery, nextThemeFor, searchPalette } from "./search";

function row(overrides: Parameters<typeof makeWine>[0], bottles = 6): CellarRow {
  return {
    wine: makeWine(overrides),
    status: "none",
    bottles,
    openLots: bottles > 0 ? 1 : 0,
    locationIds: [],
    locationNames: [],
    lastAddedAt: "2026-01-01T00:00:00.000Z",
    drunkBottles: 0,
    costPerBottle: null,
  };
}

const labels = (query: string, rows: CellarRow[] = []) =>
  Object.fromEntries(
    searchPalette(query, rows).map((g) => [g.id, g.items.map((item) => item.label)]),
  );

describe("matchesQuery", () => {
  it("needs every word, ignoring case, accents and order", () => {
    expect(matchesQuery("Château Margaux 2015", "margaux chateau")).toBe(true);
    expect(matchesQuery("Château Margaux 2015", "MARGAUX 2015")).toBe(true);
    expect(matchesQuery("Château Margaux 2015", "margaux 2016")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("searchPalette", () => {
  it("lists every page and action, and no wines, for an empty query", () => {
    const result = labels("", [row({ producer: "Ridge" })]);
    expect(result.pages).toEqual([
      "Home",
      "Cellar",
      "Add wine",
      "Scan a label",
      "Describe",
      "Add by hand",
      "Import",
      "Sommelier",
      "History",
      "Wishlist",
      "Stats",
      "Locations",
      "Backup & restore",
      "Settings",
      "Help",
      "What's new",
    ]);
    expect(result.actions).toEqual(["Back up now", "Take the tour", "Toggle dark mode"]);
    expect(result.wines).toBeUndefined();
  });

  it("filters pages and actions by all words", () => {
    expect(labels("back")).toEqual({
      pages: ["Backup & restore"],
      actions: ["Back up now"],
    });
    expect(labels("add hand")).toEqual({ pages: ["Add by hand"] });
    expect(labels("zzz")).toEqual({});
  });

  it("finds wines by producer, name and vintage, open wines first, at most 8", () => {
    const rows = [
      row({ producer: "Château Margaux", name: "", vintage: 2010 }, 0),
      row({ producer: "Château Margaux", name: "Pavillon Rouge", vintage: 2015 }),
      row({ producer: "Ridge", name: "Monte Bello", vintage: 2019 }),
    ];
    const wines = searchPalette("chateau margaux", rows).find((g) => g.id === "wines");
    expect(wines?.items.map((i) => i.label)).toEqual([
      "Château Margaux Pavillon Rouge 2015",
      "Château Margaux 2010",
    ]);
    expect(wines?.items[0]?.hint).toBe("6 bottles");
    expect(wines?.items[1]?.hint).toBe("None left");
    expect(wines?.items[0]?.run).toEqual({
      kind: "navigate",
      to: `/wine/${rows[1]!.wine.id}`,
    });

    const many = Array.from({ length: 12 }, (_, i) =>
      row({ producer: "Ridge", name: `Lot ${i}`, vintage: 2000 + i }),
    );
    expect(searchPalette("ridge", many).find((g) => g.id === "wines")?.items).toHaveLength(8);
    expect(labels("2019", rows).wines).toEqual(["Ridge Monte Bello 2019"]);
  });
});

describe("nextThemeFor", () => {
  it("flips what you see, and goes back to following the system when it can", () => {
    expect(nextThemeFor("system", false)).toBe("dark");
    expect(nextThemeFor("dark", false)).toBe("system");
    expect(nextThemeFor("system", true)).toBe("light");
    expect(nextThemeFor("light", true)).toBe("system");
    expect(nextThemeFor("light", false)).toBe("dark");
    expect(nextThemeFor("dark", true)).toBe("light");
  });
});
