import { db } from "../../db/db";
import { bottleSizeLabel } from "../../domain/labels";
import { COLOUR_LABELS } from "../../domain/types";
import { unparseCsv } from "../../lib/csv";

const COLUMNS = [
  "Producer",
  "Wine",
  "Vintage",
  "Colour",
  "Country",
  "Region",
  "Appellation",
  "Grapes",
  "Bottle size",
  "Quantity",
  "Location",
  "Bin",
  "Purchase date",
  "Price per bottle",
  "Currency",
  "Store",
  "Drink from",
  "Drink by",
];

/** Builds a CSV of the cellar, one row per open lot (R21). */
export async function buildCellarCsv(): Promise<string> {
  const [wines, lots, locations] = await Promise.all([
    db.wines.toArray(),
    db.lots.toArray(),
    db.locations.toArray(),
  ]);
  const wineById = new Map(wines.map((w) => [w.id, w]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const rows = lots
    .filter((lot) => lot.quantity > 0)
    .map((lot) => {
      const wine = wineById.get(lot.wineId);
      if (!wine || wine.deletedAt) return null;
      return {
        Producer: wine.producer,
        Wine: wine.name,
        Vintage: wine.vintage ?? "NV",
        Colour: COLOUR_LABELS[wine.colour],
        Country: wine.country ?? "",
        Region: wine.region ?? "",
        Appellation: wine.appellation ?? "",
        Grapes: wine.grapes.join(", "),
        "Bottle size": bottleSizeLabel(wine.bottleSize),
        Quantity: lot.quantity,
        Location: (lot.locationId && locationById.get(lot.locationId)?.name) || "",
        Bin: lot.bin ?? "",
        "Purchase date": lot.purchaseDate ?? "",
        "Price per bottle": lot.pricePerBottle ?? "",
        Currency: lot.currency ?? "",
        Store: lot.store ?? "",
        "Drink from": wine.windowFrom ?? "",
        "Drink by": wine.windowTo ?? "",
      };
    })
    .filter((row) => row !== null);

  return unparseCsv(rows, COLUMNS);
}
