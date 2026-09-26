import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { makeWine, resetDatabase } from "../db/testing";
import { findMatchingWine, normalizeName, wineKey } from "./match";

describe("normalizeName", () => {
  it("lowercases, strips accents and punctuation, and collapses spaces", () => {
    expect(normalizeName("  Château   Margaux ")).toBe("chateau margaux");
    expect(normalizeName("Domaine de la Romanée-Conti")).toBe("domaine de la romanee conti");
    expect(normalizeName("Taylor's")).toBe("taylor s");
    expect(normalizeName("Ch. d'Yquem")).toBe("ch d yquem");
  });
});

describe("wineKey", () => {
  it("treats Château Margaux and chateau margaux as the same wine", () => {
    expect(wineKey({ producer: "Château Margaux", name: "", vintage: 2015, bottleSize: 750 })).toBe(
      wineKey({ producer: "chateau margaux", name: "", vintage: 2015, bottleSize: 750 }),
    );
  });

  it("treats a magnum as different from a 750 ml bottle", () => {
    expect(
      wineKey({ producer: "Château Margaux", name: "", vintage: 2015, bottleSize: 1500 }),
    ).not.toBe(wineKey({ producer: "Château Margaux", name: "", vintage: 2015 }));
  });

  it("separates vintages and non-vintage", () => {
    expect(wineKey({ producer: "Krug", name: "Grande Cuvée", vintage: null })).toBe(
      "krug|grande cuvee|nv|750",
    );
    expect(wineKey({ producer: "Krug", name: "Grande Cuvée", vintage: 2008 })).not.toBe(
      wineKey({ producer: "Krug", name: "Grande Cuvée", vintage: null }),
    );
  });
});

describe("findMatchingWine", () => {
  beforeEach(resetDatabase);

  it("finds an existing wine by the normalized key", async () => {
    const wine = makeWine({ producer: "Château Margaux", name: "", vintage: 2015 });
    await db.wines.add(wine);
    const match = await findMatchingWine({ producer: "CHATEAU MARGAUX", name: "", vintage: 2015 });
    expect(match?.id).toBe(wine.id);
  });

  it("ignores deleted wines and sample wines", async () => {
    await db.wines.add(makeWine({ deletedAt: new Date().toISOString() }));
    await db.wines.add(makeWine({ isSample: true }));
    expect(
      await findMatchingWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 }),
    ).toBeUndefined();
  });
});
