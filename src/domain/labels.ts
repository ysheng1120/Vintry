import { pluralize } from "../lib/format";
import { DEFAULT_BOTTLE_SIZE, type Wine } from "./types";

/** "750 ml", "1.5 L". */
export function bottleSizeLabel(ml: number): string {
  return ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`;
}

/** Display name such as "Ridge Monte Bello 2019", "Krug Grande Cuvée NV", "… 2015 (1.5 L)". */
export function wineLabel(
  wine: Pick<Wine, "producer" | "name" | "vintage"> & { bottleSize?: number },
): string {
  const parts = [wine.producer, wine.name, wine.vintage === null ? "NV" : String(wine.vintage)];
  const label = parts.filter((p) => p && p.trim()).join(" ");
  const size = wine.bottleSize ?? DEFAULT_BOTTLE_SIZE;
  return size === DEFAULT_BOTTLE_SIZE ? label : `${label} (${bottleSizeLabel(size)})`;
}

/** "1 bottle", "6 bottles". */
export function bottles(count: number): string {
  return pluralize(count, "bottle");
}
