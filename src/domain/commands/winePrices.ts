import { z } from "zod";
import { wineLabel } from "../labels";
import { WinePricesSchema } from "../types";
import { defineCommand, notFound, type CommandContext } from "./core";

const SetWinePricesInput = z.object({
  wineId: z.string().min(1),
  /** The researched prices, or null to remove them ("Remove" on Suggested price). */
  prices: WinePricesSchema.nullable(),
});

/**
 * Saves only the `prices` field. It never touches a lot's price paid or the collector's own
 * value: those come from the collector alone (see updateWine).
 */
export const setWinePricesCommand = defineCommand({
  name: "setWinePrices",
  description: 'Set or remove a wine\'s AI-researched "Suggested price" list of web prices.',
  input: SetWinePricesInput,
  async execute({ wineId, prices }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    await changes.update("wines", wineId, { prices });
    const label = wineLabel(wine);
    let summary: string;
    if (!prices) summary = `Removed suggested prices for ${label}`;
    else if (prices.found) summary = `Found prices for ${label}`;
    else summary = `No prices found for ${label}`;
    return { summary };
  },
});

export const setWinePrices = (input: z.input<typeof SetWinePricesInput>, ctx?: CommandContext) =>
  setWinePricesCommand.run(input, ctx);
