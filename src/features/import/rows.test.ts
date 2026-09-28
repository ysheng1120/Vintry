import { describe, expect, it } from "vitest";
import type { CsvMapping } from "./presets";
import { buildImportRows, withoutProducerPrefix } from "./rows";

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

  it("plans a new location, once, for a CSV name that doesn't match", () => {
    let next = 0;
    const preview = buildImportRows(
      [
        row({ Location: "Rack  A", Bin: "3" }),
        row({ Location: "rack a" }),
        row({ Location: "Rack B" }),
        row({ Location: "Kitchen rack" }),
        row({ Location: "" }),
      ],
      {
        source: "cellartracker",
        mapping: BASE_MAPPING,
        defaultLocationId: "default-loc",
        defaultCurrency: null,
        locations: [{ id: "kitchen-id", name: "Kitchen rack" }],
        makeId: () => `new-${++next}`,
      },
    );
    expect(preview.newLocations).toEqual([
      { id: "new-1", name: "Rack A" },
      { id: "new-2", name: "Rack B" },
    ]);
    expect(preview.drafts.map((d) => d.lots?.[0]?.locationId)).toEqual([
      "new-1",
      "new-1",
      "new-2",
      "kitchen-id",
      "default-loc",
    ]);
    expect(preview.drafts[0]?.lots?.[0]?.bin).toBe("3");
  });

  it("plans no new locations when every name matches or is blank", () => {
    const preview = buildImportRows([row({ Location: "kitchen rack" }), row()], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
      locations: [{ id: "kitchen-id", name: "Kitchen rack" }],
    });
    expect(preview.newLocations).toEqual([]);
  });

  it("clears an out-of-range vintage with a warning instead of failing the row", () => {
    const preview = buildImportRows([row({ Vintage: "97" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.drafts[0]?.vintage).toBeNull();
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "vintage" }),
    );
  });

  it("clears an out-of-range drinking window year with a warning instead of failing the row", () => {
    const preview = buildImportRows([row({ BeginConsume: "0", EndConsume: "2034" })], {
      source: "cellartracker",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.drafts[0]?.windowFrom).toBeNull();
    expect(preview.drafts[0]?.windowTo).toBe(2034);
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "windowFrom" }),
    );
  });

  it("treats a bottle size of 0 as unrecognised and uses 750 ml with a warning", () => {
    const preview = buildImportRows([row({ Size: "0" })], {
      source: "cellartracker",
      mapping: { ...BASE_MAPPING, bottleSize: "Size" },
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(1);
    expect(preview.drafts[0]).not.toHaveProperty("bottleSize");
    expect(preview.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "bottleSize" }),
    );
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

describe("withoutProducerPrefix", () => {
  it("removes the producer from the start of the name, ignoring case and accents", () => {
    expect(withoutProducerPrefix("Krug Grande Cuvée", "Krug")).toBe("Grande Cuvée");
    expect(withoutProducerPrefix("chateau margaux Pavillon Rouge", "Château Margaux")).toBe(
      "Pavillon Rouge",
    );
    expect(withoutProducerPrefix("Ridge - Monte Bello", "Ridge")).toBe("Monte Bello");
    expect(withoutProducerPrefix("Château Margaux", "Château Margaux")).toBe("");
  });

  it("leaves a name alone when the producer is not a whole word at its start", () => {
    expect(withoutProducerPrefix("Grande Cuvée", "Krug")).toBe("Grande Cuvée");
    expect(withoutProducerPrefix("Krugerhof Riesling", "Krug")).toBe("Krugerhof Riesling");
    expect(withoutProducerPrefix("Monte Bello", "")).toBe("Monte Bello");
  });
});

describe("CellarTracker rows", () => {
  const CT_MAPPING: CsvMapping = {
    producer: "Producer",
    name: "Wine",
    vintage: "Vintage",
    colour: "Color",
    quantity: "Quantity",
  };
  const ct = (overrides: Record<string, string>) => ({
    Producer: "Krug",
    Wine: "Krug Grande Cuvée",
    Vintage: "1001",
    Color: "White",
    Category: "Sparkling",
    Type: "White - Sparkling",
    Quantity: "2",
    Pending: "0",
    ...overrides,
  });
  const build = (rows: Record<string, string>[]) =>
    buildImportRows(rows, {
      source: "cellartracker",
      mapping: CT_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });

  it("keeps CellarTracker's own wine id (iWine) on the draft, but only for a CellarTracker file", () => {
    expect(build([ct({ iWine: " 100001 " }), ct({ iWine: "" })]).drafts[0]?.cellarTrackerId).toBe(
      "100001",
    );
    expect(build([ct({ iWine: "" })]).drafts[0]).not.toHaveProperty("cellarTrackerId");
    const generic = buildImportRows([ct({ iWine: "100001" })], {
      source: "generic",
      mapping: CT_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(generic.drafts[0]).not.toHaveProperty("cellarTrackerId");
  });

  it("reads Type and Category with Color, so Champagne is sparkling and Port fortified", () => {
    const preview = build([
      ct({}),
      ct({
        Producer: "Taylor Fladgate",
        Wine: "Taylor Fladgate Vintage Port",
        Vintage: "2011",
        Color: "Red",
        Category: "Fortified",
        Type: "Red - Fortified",
      }),
      ct({
        Producer: "Château d'Yquem",
        Wine: "Château d'Yquem",
        Vintage: "2009",
        Color: "White",
        Category: "Sweet/Dessert",
        Type: "White - Sweet/Dessert",
      }),
      ct({
        Producer: "Ridge",
        Wine: "Ridge Monte Bello",
        Color: "Red",
        Category: "Dry",
        Type: "Red",
      }),
    ]);
    expect(preview.drafts.map((d) => d.colour)).toEqual([
      "sparkling",
      "fortified",
      "dessert",
      "red",
    ]);
    expect(preview.drafts.map((d) => d.name)).toEqual([
      "Grande Cuvée",
      "Vintage Port",
      "",
      "Monte Bello",
    ]);
  });

  it("skips a row with only bottles on order, and warns about pending bottles on a row", () => {
    const preview = build([
      ct({ Quantity: "0", Pending: "6" }),
      ct({ Quantity: "2", Pending: "3" }),
    ]);
    expect(preview.drafts).toHaveLength(1);
    expect(preview.rows[0]?.issues[0]).toMatchObject({
      kind: "skipped",
      message: "6 on order, none delivered yet; row skipped",
    });
    expect(preview.drafts[0]?.lots?.[0]?.quantity).toBe(2);
    expect(preview.rows[1]?.issues.map((i) => i.message)).toContain(
      "3 more on order were left out; add them when they arrive",
    );
  });

  it("skips a row with 0 bottles instead of importing it as 1 bottle", () => {
    const preview = buildImportRows([row({ Quantity: "0" })], {
      source: "generic",
      mapping: BASE_MAPPING,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.drafts).toHaveLength(0);
    expect(preview.rows[0]?.issues[0]?.message).toBe("0 bottles; row skipped");
  });
});
