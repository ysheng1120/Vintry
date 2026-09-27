import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { importRows } from "../../domain/commands";
import { undoBatch } from "../../domain/undo";
import { decodeCsvBytes, parseCsvFile, parseCsvText } from "../../lib/csv";
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

    const result = await importRows({ rows: preview.drafts });
    const wines = await db.wines.toArray();
    expect(wines.map((w) => w.producer).sort()).toEqual(
      ["Château Margaux", "Domaine Leflaive", "Domaine de la Côte-Rôtie"].sort(),
    );
    expect(wines.find((w) => w.producer === "Château Margaux")).toMatchObject({ vintage: 2015 });

    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);
    expect(await db.wines.count()).toBe(0);
    expect(await db.lots.count()).toBe(0);
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

    await importRows({ rows: preview.drafts });
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
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await db.wines.count()).toBe(300);

    const undone = await undoBatch(result.batchId!);
    expect(undone.ok).toBe(true);
    expect(await db.wines.count()).toBe(0);
  });
});
