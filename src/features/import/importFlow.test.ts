import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { importRows } from "../../domain/commands";
import { undoBatch } from "../../domain/undo";
import { decodeCsvBytes, parseCsvFile, parseCsvText } from "../../lib/csv";
import { draftsToImport, planImportRows } from "./duplicates";
import { detectImportSource, presetMapping } from "./presets";
import { buildImportRows } from "./rows";

const FIXTURES = join(__dirname, "../../../e2e/fixtures");

function readFixture(name: string): ArrayBuffer {
  const buffer = readFileSync(join(FIXTURES, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe("import fixtures", () => {
  beforeEach(resetDatabase);

  it("decodes the windows-1252 CellarTracker fixture with correct accents", () => {
    const text = decodeCsvBytes(readFixture("cellartracker.csv"));
    expect(text).toContain("Château Margaux");
    expect(text).toContain("Côte-Rôtie");
  });

  it("imports the CellarTracker fixture: accents, 9999 window sentinel, 1001 NV vintage", async () => {
    const { headers, rows } = parseCsvFile(readFixture("cellartracker.csv"));
    const source = detectImportSource(headers);
    expect(source).toBe("cellartracker");

    const mapping = presetMapping(source, headers);
    const preview = buildImportRows(rows, {
      source,
      mapping,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(3);
    expect(preview.skippedCount).toBe(0);

    const nv = preview.drafts.find((d) => d.producer === "Domaine de la Côte-Rôtie");
    expect(nv?.vintage).toBeNull();
    expect(nv).toMatchObject({ windowFrom: null, windowTo: null, appellation: "Côte-Rôtie" });
    expect(preview.drafts.find((d) => d.producer === "Château Margaux")).toMatchObject({
      colour: "red",
      country: "France",
    });

    const result = await importRows({
      rows: preview.drafts,
      newLocations: preview.newLocations,
    });
    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.producer).sort()).toEqual(
      ["Château Margaux", "Domaine Leflaive", "Domaine de la Côte-Rôtie"].sort(),
    );
    expect(wines.find((w) => w.producer === "Château Margaux")).toMatchObject({ vintage: 2015 });
    // The file's Location column becomes real locations, not "No location".
    const locations = await db.locations.toArray();
    expect(locations.map((l) => l.name).sort()).toEqual(["Cellar", "Kitchen Rack"]);
    expect((await db.lots.toArray()).every((l) => l.locationId !== null)).toBe(true);

    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);
    expect(await db.wines.count()).toBe(0);
    expect(await db.lots.count()).toBe(0);
    expect(await db.locations.count()).toBe(0);
  });

  it("maps the Vivino fixture with the built-in preset, needing no AI", async () => {
    const { headers, rows } = parseCsvFile(readFixture("vivino.csv"));
    const source = detectImportSource(headers);
    expect(source).toBe("vivino");

    const mapping = presetMapping(source, headers);
    expect(mapping.producer).toBe("Winery");
    expect(mapping.name).toBe("Wine name");

    const preview = buildImportRows(rows, {
      source,
      mapping,
      defaultLocationId: null,
      defaultCurrency: "USD",
    });
    expect(preview.includedCount).toBe(2);
    const montebello = preview.drafts.find((d) => d.name === "Monte Bello");
    expect(montebello).toMatchObject({ producer: "Ridge Vineyards", vintage: 2018, colour: "red" });
    // Vivino's 5-star rating (4.5) becomes a 100-point rating.
    expect(montebello?.rating).toBe(90);
    expect(montebello?.lots?.[0]).toMatchObject({ quantity: 1, currency: "USD" });

    await importRows({ rows: preview.drafts, newLocations: preview.newLocations });
    expect(await db.wines.count()).toBe(2);
  });

  it("parses the semicolon-delimited, decimal-comma EU fixture", () => {
    const { headers, rows, delimiter } = parseCsvText(
      decodeCsvBytes(readFixture("eu-semicolon.csv")),
    );
    expect(delimiter).toBe(";");

    const preview = buildImportRows(rows, {
      source: "generic",
      mapping: {
        producer: "Producer",
        name: "Cuvee",
        vintage: "Vintage",
        colour: "Colour",
        country: "Country",
        region: "Region",
        quantity: "Quantity",
        pricePerBottle: "Price",
        currency: "Currency",
      },
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(2);
    expect(preview.drafts[0]?.lots?.[0]?.pricePerBottle).toBe(12.5);
    expect(preview.drafts[1]?.lots?.[0]?.pricePerBottle).toBe(9.9);
    expect(headers).toContain("Cuvee");
  });

  it("imports the rest of the file when one row has a bad vintage, window year, or size", async () => {
    const rows = [
      { Producer: "Good Producer", Wine: "Good Wine", Vintage: "2019", Quantity: "1" },
      { Producer: "Bad Vintage Co", Wine: "Odd Vintage", Vintage: "97", Quantity: "1" },
      { Producer: "Another Good One", Wine: "Fine Wine", Vintage: "2015", Quantity: "1" },
    ];
    const mapping = {
      producer: "Producer",
      name: "Wine",
      vintage: "Vintage",
      quantity: "Quantity",
    } as const;

    const preview = buildImportRows(rows, {
      source: "generic",
      mapping,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(3);
    expect(preview.skippedCount).toBe(0);
    const badRow = preview.rows.find((r) => r.draft?.producer === "Bad Vintage Co");
    expect(badRow?.draft?.vintage).toBeNull();
    expect(badRow?.issues).toContainEqual(
      expect.objectContaining({ kind: "warning", field: "vintage" }),
    );

    const result = await importRows({ rows: preview.drafts });
    expect(result.touched.wineIds).toHaveLength(3);
    const wines = await db.wines.toArray();
    expect(wines).toHaveLength(3);
    expect(wines.find((w) => w.producer === "Bad Vintage Co")?.vintage).toBeNull();
  });

  it("detects the generic fixture as generic, needing a manual mapping", () => {
    const { headers } = parseCsvFile(readFixture("generic.csv"));
    expect(detectImportSource(headers)).toBe("generic");
    expect(presetMapping("generic", headers)).toEqual({});
  });
});

describe("re-importing an updated CellarTracker export", () => {
  beforeEach(resetDatabase);

  const HEADERS = "iWine,Producer,Wine,Vintage,Color,Quantity,Location,Bin,Price,Currency\n";
  const csv = (lines: string[]) => HEADERS + lines.join("\n") + "\n";

  function preview(text: string) {
    const { headers, rows } = parseCsvText(text);
    const source = detectImportSource(headers);
    expect(source).toBe("cellartracker");
    return buildImportRows(rows, {
      source,
      mapping: presetMapping(source, headers),
      defaultLocationId: null,
      defaultCurrency: null,
    });
  }

  /** Builds the rows against the live cellar and plans them the way the import page does. */
  async function plannedImport(text: string, included = new Set<number>()) {
    const locations = (await db.locations.toArray()).map((l) => ({ id: l.id, name: l.name }));
    const { headers, rows } = parseCsvText(text);
    const source = detectImportSource(headers);
    const built = buildImportRows(rows, {
      source,
      mapping: presetMapping(source, headers),
      defaultLocationId: null,
      defaultCurrency: null,
      locations,
    });
    const cellar = {
      wines: await db.wines.toArray(),
      lots: await db.lots.toArray(),
      locations,
    };
    const plans = planImportRows(built.rows, cellar, { compareCounts: true });
    const kept = draftsToImport(built.rows, plans, included);
    return { built, plans, kept };
  }

  const FIRST = csv([
    "100001,Ridge,Ridge Monte Bello,2019,Red,6,Cellar,A1,250,USD",
    "100002,Krug,Krug Grande Cuvée,1001,White,6,Cellar,B2,180,GBP",
  ]);

  it("keeps CellarTracker's wine id on the wines it creates", async () => {
    const first = preview(FIRST);
    expect(first.drafts.map((d) => d.cellarTrackerId)).toEqual(["100001", "100002"]);
    await importRows({ rows: first.drafts, newLocations: first.newLocations });
    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.cellarTrackerId).sort()).toEqual(["100001", "100002"]);
  });

  it("adds only the new bottle, leaves out a row with fewer, and one undo removes the top-up", async () => {
    const first = preview(FIRST);
    await importRows({ rows: first.drafts, newLocations: first.newLocations });
    expect(await db.lots.count()).toBe(2);

    // In CellarTracker: one more Monte Bello bought, two Krug drunk; Monte Bello renamed in Vintry.
    const ridge = (await db.wines.toArray()).find((w) => w.producer === "Ridge")!;
    await db.wines.update(ridge.id, { name: "Monte Bello (estate)" });
    const { plans, kept } = await plannedImport(
      csv([
        "100001,Ridge,Ridge Monte Bello,2019,Red,7,Cellar,A1,250,USD",
        "100002,Krug,Krug Grande Cuvée,1001,White,4,Cellar,B2,180,GBP",
      ]),
    );
    expect(plans.get(0)).toEqual({ kind: "topUp", add: 1, have: 6 });
    expect(plans.get(1)).toEqual({ kind: "fewer", have: 6, file: 4 });
    expect(kept).toHaveLength(1);

    const result = await importRows({ rows: kept.map((k) => k.draft) });
    expect(result.summary).toBe("Imported 1 wine (1 bottle)");
    expect(await db.wines.count()).toBe(2);
    const ridgeLots = await db.lots.where("wineId").equals(ridge.id).toArray();
    expect(ridgeLots.map((l) => l.quantity).sort()).toEqual([1, 6]);
    const krug = (await db.wines.toArray()).find((w) => w.producer === "Krug")!;
    const krugLots = await db.lots.where("wineId").equals(krug.id).toArray();
    expect(krugLots.map((l) => l.quantity)).toEqual([6]);

    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);
    const after = await db.lots.where("wineId").equals(ridge.id).toArray();
    expect(after.map((l) => l.quantity)).toEqual([6]);
    expect(await db.wines.count()).toBe(2);
  });

  it("imports the whole row when included anyway", async () => {
    const first = preview(FIRST);
    await importRows({ rows: first.drafts, newLocations: first.newLocations });
    const { kept } = await plannedImport(
      csv(["100001,Ridge,Ridge Monte Bello,2019,Red,7,Cellar,A1,250,USD"]),
      new Set([0]),
    );
    const result = await importRows({ rows: kept.map((k) => k.draft) });
    expect(result.summary).toBe("Imported 1 wine (7 bottles)");
  });

  it("records CellarTracker's id on a wine that had none when a row joins it", async () => {
    await importRows({
      rows: [{ producer: "Ridge", name: "Monte Bello", vintage: 2019, colour: "red", lots: [] }],
    });
    const { built, kept } = await plannedImport(
      csv(["100001,Ridge,Ridge Monte Bello,2019,Red,2,Cellar,A1,250,USD"]),
    );
    await importRows({ rows: kept.map((k) => k.draft), newLocations: built.newLocations });
    const wines = await db.wines.toArray();
    expect(wines).toHaveLength(1);
    expect(wines[0]?.cellarTrackerId).toBe("100001");
  });
});

describe("large import", () => {
  beforeEach(resetDatabase);

  it("imports 300 rows quickly and undo removes them all", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      Producer: `Producer ${i}`,
      Wine: `Cuvée ${i}`,
      Vintage: String(2000 + (i % 20)),
      Color: i % 2 === 0 ? "Red" : "White",
      Quantity: "1",
    }));
    const mapping = {
      producer: "Producer",
      name: "Wine",
      vintage: "Vintage",
      colour: "Color",
      quantity: "Quantity",
    } as const;

    const started = Date.now();
    const preview = buildImportRows(rows, {
      source: "generic",
      mapping,
      defaultLocationId: null,
      defaultCurrency: null,
    });
    expect(preview.includedCount).toBe(300);

    const result = await importRows({ rows: preview.drafts });
    // A guard against an order-of-magnitude regression, not a benchmark (machines under load vary).
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await db.wines.count()).toBe(300);

    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);
    expect(await db.wines.count()).toBe(0);
  });
});
