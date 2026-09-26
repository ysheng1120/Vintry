#!/usr/bin/env node
/**
 * Generates the sample CSV files import tests and e2e journeys read (U10). Not part of the app
 * build; run manually with `node e2e/fixtures/make-fixtures.mjs` after changing this file.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

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

const CELLARTRACKER_ROWS = [
  [
    "100001",
    "Wine",
    "Red",
    "Red Wine",
    "2015",
    "Grand Vin",
    "France",
    "Château Margaux",
    "Cabernet Sauvignon",
    "Cabernet Sauvignon",
    "",
    "",
    "France",
    "Bordeaux",
    "Medoc",
    "Margaux",
    "3",
    "0",
    "750ml",
    "120.00",
    "150.00",
    "2022",
    "2035",
    "Cellar",
    "A1",
  ],
  [
    // Non-vintage (1001) with no drinking window yet from CellarTracker's free tier (9999).
    "100002",
    "Wine",
    "Red",
    "Red Wine",
    "1001",
    "Cuvée Non Vintage",
    "France",
    "Domaine de la Côte-Rôtie",
    "Syrah",
    "Syrah",
    "",
    "",
    "France",
    "Rhône",
    "",
    "Côte-Rôtie",
    "2",
    "0",
    "750ml",
    "45.50",
    "",
    "9999",
    "9999",
    "Kitchen Rack",
    "B2",
  ],
  [
    "100003",
    "Wine",
    "White",
    "White Wine",
    "2019",
    "Les Pucelles",
    "France",
    "Domaine Leflaive",
    "Chardonnay",
    "Chardonnay",
    "",
    "",
    "France",
    "Burgundy",
    "Côte de Beaune",
    "Puligny-Montrachet",
    "1",
    "0",
    "750ml",
    "210.00",
    "260.00",
    "2021",
    "2027",
    "Cellar",
    "A2",
  ],
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

const VIVINO_ROWS = [
  [
    "Ridge Vineyards",
    "Monte Bello",
    "2018",
    "California",
    "United States",
    "Red wine",
    "4.5",
    "Great with steak",
    "Cellar for 5 more years",
    "2024-05-01",
    "https://example.com/label.jpg",
    "4.3",
    "85.00",
  ],
  [
    "Domaine Zind-Humbrecht",
    "Riesling",
    "2019",
    "Alsace",
    "France",
    "White wine",
    "4.0",
    "Crisp and mineral",
    "",
    "2024-06-15",
    "",
    "4.1",
    "32.50",
  ],
];

const EU_HEADERS = [
  "Producer",
  "Cuvee",
  "Vintage",
  "Country",
  "Region",
  "Colour",
  "Quantity",
  "Price",
  "Currency",
];
const EU_ROWS = [
  ["Domaine Dupont", "Reserve", "2017", "France", "Loire", "Red", "6", "12,50", "EUR"],
  ["Weingut Muller", "Riesling Kabinett", "2020", "Germany", "Mosel", "White", "12", "9,90", "EUR"],
];

const GENERIC_HEADERS = ["Maker", "Label", "Yr", "Hue", "Bottles", "Cost each", "Money", "Where"];
const GENERIC_ROWS = [
  ["Two Hands", "Bella's Garden Shiraz", "2015", "Red", "6", "45.00", "AUD", "Garage shelf"],
  ["Cloudy Bay", "Sauvignon Blanc", "2022", "White", "12", "22.00", "NZD", "Wine fridge"],
];

/** Quotes a field only when it needs it (contains the delimiter, a quote, or a newline). */
function csvField(value, delimiter) {
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(headers, rows, delimiter = ",") {
  const lines = [headers, ...rows].map((cells) =>
    cells.map((cell) => csvField(String(cell), delimiter)).join(delimiter),
  );
  return lines.join("\r\n") + "\r\n";
}

function writeUtf8(name, text) {
  writeFileSync(join(DIR, name), text, "utf-8");
}

/**
 * Writes text as windows-1252 bytes. Every character used in these fixtures (é, ô, ç, à, …) sits
 * in the Latin-1 Supplement block, which windows-1252 and ISO-8859-1/Latin-1 encode identically,
 * so Node's built-in "latin1" byte encoding produces valid windows-1252 bytes here.
 */
function writeWindows1252(name, text) {
  writeFileSync(join(DIR, name), Buffer.from(text, "latin1"));
}

writeWindows1252("cellartracker.csv", toCsv(CELLARTRACKER_HEADERS, CELLARTRACKER_ROWS));
writeUtf8("vivino.csv", toCsv(VIVINO_HEADERS, VIVINO_ROWS));
writeUtf8("eu-semicolon.csv", toCsv(EU_HEADERS, EU_ROWS, ";"));
writeUtf8("generic.csv", toCsv(GENERIC_HEADERS, GENERIC_ROWS));

console.log("Wrote cellartracker.csv, vivino.csv, eu-semicolon.csv, generic.csv");
