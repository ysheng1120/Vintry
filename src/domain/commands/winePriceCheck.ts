import { z } from "zod";
import { wineLabel } from "../labels";
import { WinePriceCheckSchema } from "../types";
import { defineCommand, notFound, type CommandContext } from "./core";

const SetWinePriceCheckInput = z.object({
  wineId: z.string().min(1),
  /** The checked prices, or null to remove them ("Remove" on the price section). */
  priceCheck: WinePriceCheckSchema.nullable(),
});

export const setWinePriceCheckCommand = defineCommand({
  name: "setWinePriceCheck",
  description: "Set or remove a wine's AI-researched shop-price check (Check price).",
  input: SetWinePriceCheckInput,
  async execute({ wineId, priceCheck }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    await changes.update("wines", wineId, { priceCheck });
    const label = wineLabel(wine);
    let summary: string;
    if (!priceCheck) summary = `Removed the price check for ${label}`;
    else if (priceCheck.found) summary = `Found prices for ${label}`;
    else summary = `No current prices found for ${label}`;
    return { summary };
  },
});

export const setWinePriceCheck = (
  input: z.input<typeof SetWinePriceCheckInput>,
  ctx?: CommandContext,
) => setWinePriceCheckCommand.run(input, ctx);
