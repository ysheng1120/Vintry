import { z } from "zod";
import { toIsoDate } from "../../lib/format";
import { newId } from "../../lib/id";
import { now, nowIso } from "../clock";
import type { ChangeSet } from "../events";
import { bottles, wineLabel } from "../labels";
import { IsoDateSchema, RatingSchema, type Lot } from "../types";
import { cleanText, CommandError, defineCommand, notFound, type CommandContext } from "./core";

/** Loads an open lot and checks it holds enough bottles (and the expected count, if given). */
export async function openLotWithAtLeast(
  changes: ChangeSet,
  lotId: string,
  quantity: number,
  expectedQuantity?: number,
): Promise<Lot> {
  const lot = await changes.get("lots", lotId);
  if (!lot) throw notFound("lot");
  if (expectedQuantity !== undefined && lot.quantity !== expectedQuantity) {
    throw new CommandError(`This lot now holds ${bottles(lot.quantity)}, not ${expectedQuantity}.`);
  }
  if (lot.quantity === 0) throw new CommandError("This lot is empty.");
  if (quantity > lot.quantity) {
    throw new CommandError(`Only ${bottles(lot.quantity)} left in this lot.`);
  }
  return lot;
}

export const expectedQuantityField = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("The lot's quantity when you last read it; the change is refused if it differs");

const ConsumeInput = z.object({
  lotId: z.string().min(1).describe("Lot id to drink from"),
  quantity: z.number().int().min(1).default(1).describe("Bottles drunk"),
  date: IsoDateSchema.optional().describe("Date drunk, YYYY-MM-DD; default today"),
  rating: RatingSchema.nullable().optional().describe("The user's score out of 100"),
  note: z.string().nullable().optional().describe("Tasting note, saved as a tasting note"),
  occasion: z.string().nullable().optional().describe("Occasion, for example Birthday dinner"),
  expectedQuantity: expectedQuantityField,
});

export const consumeBottlesCommand = defineCommand({
  name: "consumeBottles",
  description:
    "Record drinking bottles from a lot. Keeps the history; a lot at zero is closed, not deleted.",
  input: ConsumeInput,
  async execute(input, changes) {
    const lot = await openLotWithAtLeast(
      changes,
      input.lotId,
      input.quantity,
      input.expectedQuantity,
    );
    const wine = await changes.get("wines", lot.wineId);
    if (!wine) throw notFound("wine");

    const remaining = lot.quantity - input.quantity;
    await changes.update("lots", lot.id, {
      quantity: remaining,
      closedAt: remaining === 0 ? nowIso() : null,
    });

    const date = input.date ?? toIsoDate(now());
    const rating = input.rating ?? null;
    const t = nowIso();
    const consumptionId = newId();
    await changes.insert("consumptions", {
      id: consumptionId,
      createdAt: t,
      updatedAt: t,
      wineId: wine.id,
      lotId: lot.id,
      date,
      quantity: input.quantity,
      rating,
      occasion: cleanText(input.occasion),
      isSample: false,
    });

    const text = cleanText(input.note);
    if (text) {
      await changes.insert("tastingNotes", {
        id: newId(),
        createdAt: t,
        updatedAt: t,
        wineId: wine.id,
        consumptionId,
        date,
        text,
        rating,
        isSample: false,
      });
    }
    return { summary: `Drank ${bottles(input.quantity)} of ${wineLabel(wine)}` };
  },
});

export const consumeBottles = (input: z.input<typeof ConsumeInput>, ctx?: CommandContext) =>
  consumeBottlesCommand.run(input, ctx);
