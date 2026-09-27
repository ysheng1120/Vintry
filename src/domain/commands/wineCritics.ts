import { z } from "zod";
import { wineLabel } from "../labels";
import { WineCriticsSchema } from "../types";
import { defineCommand, notFound, type CommandContext } from "./core";

const SetWineCriticsInput = z.object({
  wineId: z.string().min(1),
  /** The researched summary, or null to remove it ("Remove" on What critics say). */
  critics: WineCriticsSchema.nullable(),
});

export const setWineCriticsCommand = defineCommand({
  name: "setWineCritics",
  description: 'Set or remove a wine\'s AI-researched "What critics say" summary.',
  input: SetWineCriticsInput,
  async execute({ wineId, critics }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    await changes.update("wines", wineId, { critics });
    const label = wineLabel(wine);
    let summary: string;
    if (!critics) summary = `Removed what critics say about ${label}`;
    else if (critics.found) summary = `Found what critics say about ${label}`;
    else summary = `No critic reviews found for ${label}`;
    return { summary };
  },
});

export const setWineCritics = (input: z.input<typeof SetWineCriticsInput>, ctx?: CommandContext) =>
  setWineCriticsCommand.run(input, ctx);
