import { bottles } from "../../domain/labels";
import type { LotWithLocation } from "../../domain/selectors";

/** "Kitchen rack, bin A1 (6 bottles)" for lot pickers. */
export function lotLabel(lot: LotWithLocation): string {
  const place = lot.locationName ?? "No location";
  return `${place}${lot.bin ? `, bin ${lot.bin}` : ""} (${bottles(lot.quantity)})`;
}
