import { describe, expect, it } from "vitest";
import {
  detectImportSource,
  normalizeColour,
  normalizeVintage,
  normalizeWindowYear,
  parseBottleSizeMl,
  presetMapping,
} from "./presets";

const CELLARTRACKER_HEADERS = [
  "iWine",
  "Type",
  "Color",
  "Category",
  "Vintage",
  "Wine",
  "Locale",
  "Producer",
  "Varietal",
  "MasterVarietal",
  "Designation",
  "Vineyard",
  "Country",
  "Region",
  "SubRegion",
  "Appellation",
  "Quantity",
  "Pending",
  "Size",
  "Price",
  "Valuation",
  "BeginConsume",
  "EndConsume",
  "Location",
  "Bin",
];

const VIVINO_HEADERS = [
  "Winery",
  "Wine name",
  "Vintage",
  "Region",
  "Country",
  "Wine type",
  "Your rating",
  "Your review",
  "Personal note",
  "Scan date",
  "Label image",
  "Average rating",
  "Wine price",
];

describe("detectImportSource", () => {
  it("detects CellarTracker from its headers", () => {
    expect(detectImportSource(CELLARTRACKER_HEADERS)).toBe("cellartracker");
  });

  it("detects Vivino from its headers", () => {
    expect(detectImportSource(VIVINO_HEADERS)).toBe("vivino");
  });

  it("falls back to generic for unrecognised headers", () => {
    expect(detectImportSource(["Bottle", "Maker", "Yr", "Notes"])).toBe("generic");
  });
});

describe("presetMapping", () => {
  it("maps CellarTracker headers with no AI", () => {
    const mapping = presetMapping("cellartracker", CELLARTRACKER_HEADERS);
    expect(mapping).toMatchObject({
      producer: "Producer",
      name: "Wine",
      vintage: "Vintage",
      colour: "Color",
      country: "Country",
      region: "Region",
      appellation: "Appellation",
      bottleSize: "Size",
      quantity: "Quantity",
      location: "Location",
      bin: "Bin",
      pricePerBottle: "Price",
      windowFrom: "BeginConsume",
      windowTo: "EndConsume",
    });
  });

  it("maps Vivino headers with no AI", () => {
    const mapping = presetMapping("vivino", VIVINO_HEADERS);
    expect(mapping).toMatchObject({
      producer: "Winery",
      name: "Wine name",
      vintage: "Vintage",
      colour: "Wine type",
      country: "Country",
      region: "Region",
      rating: "Your rating",
      notes: "Personal note",
      pricePerBottle: "Wine price",
    });
  });

  it("returns an empty mapping for generic files", () => {
    expect(presetMapping("generic", ["Bottle", "Maker"])).toEqual({});
  });
});

describe("normalizeColour", () => {
  it.each([
    ["Red", "red"],
    ["Red Wine", "red"],
    ["White", "white"],
    ["Rosé", "rose"],
    ["Rose", "rose"],
    ["Sparkling", "sparkling"],
    ["Champagne + Sparkling", "sparkling"],
    ["Dessert", "dessert"],
    // A combined CellarTracker category; either reading is defensible, dessert wins the tie.
    ["Dessert & Fortified", "dessert"],
    ["Fortified", "fortified"],
    ["Port", "fortified"],
    ["Orange", "orange"],
    ["Rouge", "red"],
    ["Blanc", "white"],
    ["Rosso", "red"],
    ["Bianco", "white"],
  ] as const)("maps %s to %s", (raw, expected) => {
    expect(normalizeColour(raw)).toBe(expected);
  });

  it("returns null for unrecognised or empty text", () => {
    expect(normalizeColour("Mystery")).toBeNull();
    expect(normalizeColour("")).toBeNull();
    expect(normalizeColour(null)).toBeNull();
  });
});

describe("normalizeVintage", () => {
  it("maps CellarTracker's 1001 sentinel to NV (null)", () => {
    expect(normalizeVintage("1001")).toBeNull();
  });

  it("parses a normal vintage year", () => {
    expect(normalizeVintage("2019")).toBe(2019);
  });

  it("treats blank as NV", () => {
    expect(normalizeVintage("")).toBeNull();
    expect(normalizeVintage(null)).toBeNull();
  });
});

describe("normalizeWindowYear", () => {
  it("maps the 9999 sentinel to no window (null)", () => {
    expect(normalizeWindowYear("9999")).toBeNull();
  });

  it("parses a normal year", () => {
    expect(normalizeWindowYear("2028")).toBe(2028);
  });

  it("treats blank as no window", () => {
    expect(normalizeWindowYear("")).toBeNull();
  });
});

describe("parseBottleSizeMl", () => {
  it.each([
    ["750ml", 750],
    ["750 ml", 750],
    ["Magnum", 1500],
    ["1.5L", 1500],
    ["1.5 L", 1500],
    ["375ml", 375],
    ["Half", 375],
    ["37.5cl", 375],
  ] as const)("parses %s as %d ml", (raw, expected) => {
    expect(parseBottleSizeMl(raw)).toBe(expected);
  });

  it("returns undefined for unreadable input", () => {
    expect(parseBottleSizeMl("")).toBeUndefined();
    expect(parseBottleSizeMl(null)).toBeUndefined();
    expect(parseBottleSizeMl("mystery size")).toBeUndefined();
  });
});
