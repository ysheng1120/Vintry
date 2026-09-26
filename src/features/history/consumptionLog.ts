import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/db";
import { wineLabel } from "../../domain/labels";

export interface ConsumptionLogRow {
  id: string;
  date: string;
  wineId: string;
  wineLabel: string;
  quantity: number;
  rating: number | null;
  note: string | null;
}

/** Every drink across the cellar, newest first, with the wine's label and its note (KTD9). */
async function loadConsumptionLog(): Promise<ConsumptionLogRow[]> {
  const [consumptions, wines, notes] = await Promise.all([
    db.consumptions.toArray(),
    db.wines.toArray(),
    db.tastingNotes.toArray(),
  ]);
  const wineById = new Map(wines.map((w) => [w.id, w]));
  const noteByConsumption = new Map(
    notes.filter((n) => n.consumptionId).map((n) => [n.consumptionId as string, n]),
  );
  return consumptions
    .map((c) => {
      const wine = wineById.get(c.wineId);
      return {
        id: c.id,
        date: c.date,
        wineId: c.wineId,
        wineLabel: wine ? wineLabel(wine) : "A deleted wine",
        quantity: c.quantity,
        rating: c.rating,
        note: noteByConsumption.get(c.id)?.text ?? null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export function useConsumptionLog(): ConsumptionLogRow[] | undefined {
  return useLiveQuery(loadConsumptionLog, []);
}
