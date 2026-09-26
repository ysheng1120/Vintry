import { describe, expect, it } from "vitest";
import type { CsvMapping } from "./presets";
import { buildImportRows } from "./rows";

const BASE_MAPPING: CsvMapping = {
  producer: "Producer",
  name: "Wine",
  vintage: "Vintage",
  colour: "Color",
  country: "Country",
  region: "Region",
  quantity: "Quantity",
  pricePerBottle: "Price",
  currency: "Currency",
  windowFrom: "BeginConsume",
  windowTo: "EndConsume",
  location: "Location",
  bin: "Bin",
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Producer: "Ridge",
    Wine: "Monte Bello",
    Vintage: "2019",
    Color: "Red",
    Country: "USA",
    Region: "California",
    Quantity: "6",
    Price: "50",
    Currency: "USD",
    BeginConsume: "2024",
    EndConsume: "2034",
    Location: "",
    Bin: "",
    ...overrides,
  };
}

describe("buildImportRows", () => {
  it("builds a draft from a fully mapped row", () => {
    const preview = buildImportRows([row()], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: "loc-1",
      defaultCurrency: "GBP",
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.skippedCount).toBe(0);
    expect(preview.bottleCount).toBe(6);
    expect(preview.drafts[0]).toMatchObject({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      colour: "red",
      country: "USA",
      region: "California",
      windowFrom: 2024,
      windowTo: 2034,
    });
    expect(preview.drafts[0]?.lots?.[0]).toMatchObject({
      quantity: 6,
      pricePerBottle: 50,
      currency: "USD",
      locationId: "loc-1",
    });
  });

  it("maps CellarTracker's 9999 window sentinel to no window", () => {
    const preview = buildImportRows([row({ BeginConsume: "9999", EndConsume: "9999" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]).toMatchObject({ windowFrom: null, windowTo: null });
  });

  it("maps CellarTracker's 1001 vintage sentinel to NV", () => {
    const preview = buildImportRows([row({ Vintage: "1001" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]?.vintage).toBeNull();
  });

  it("parses a decimal-comma price", () => {
    const preview = buildImportRows([row({ Price: "12,50", Currency: "" })], {
      source: "generic",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: "EUR",
    });
    expect(preview.drafts[0]?.lots?.[0]).toMatchObject({ pricePerBottle: 12.5, currency: "EUR" });
  });

  it("skips a row with no producer and counts it", () => {
    const preview = buildImportRows([row({ Producer: "" }), row()], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.skippedCount).toBe(1);
    expect(preview.rows[0]?.draft).toBeNull();
    expect(preview.rows[0]?.issues[0]).toMatchObject({ kind: "skipped", field: "producer" });
  });

  it("clears an unreadable number with a warning instead of failing the row", () => {
    const preview = buildImportRows([row({ Price: "not a price" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.drafts[0]?.lots?.[0]?.pricePerBottle).toBeNull();
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "pricePerBottle" }),
    );
  });

  it("defaults colour to red with a warning when the value isn't recognised", () => {
    const preview = buildImportRows([row({ Color: "Mystery" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]?.colour).toBe("red");
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "colour" }),
    );
  });

  it("clears an invalid drinking window (end before start) with a warning", () => {
    const preview = buildImportRows([row({ BeginConsume: "2030", EndConsume: "2020" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]).toMatchObject({ windowFrom: null, windowTo: null });
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "windowTo" }),
    );
  });

  it("defaults quantity to 1 bottle when missing", () => {
    const preview = buildImportRows([row({ Quantity: "" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]?.lots?.[0]?.quantity).toBe(1);
  });

  it("matches a CSV location name to an existing location, case-insensitively", () => {
    const preview = buildImportRows([row({ Location: "kitchen RACK" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: "default-loc",
      defaultCurrency: null,
      locations: [{ id: "kitchen-id", name: "Kitchen rack" }],
    });
    expect(preview.drafts[0]?.lots?.[0]?.locationId).toBe("kitchen-id");
  });

  it("falls back to the default location when the CSV name doesn't match", () => {
    const preview = buildImportRows([row({ Location: "Unknown place" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: "default-loc",
      defaultCurrency: null,
      locations: [{ id: "kitchen-id", name: "Kitchen rack" }],
    });
    expect(preview.drafts[0]?.lots?.[0]?.locationId).toBe("default-loc");
  });

  it("scales a Vivino 5-star rating to the 100-point scale", () => {
    const preview = buildImportRows([row({ MyRating: "4.5" })], {
      source: "vivino",
      mapping: { ...BASE_MAPPING, rating: "MyRating" },
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts[0]?.rating).toBe(90);
  });
});
