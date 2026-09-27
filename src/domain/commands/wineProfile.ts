import { z } from "zod";
import { wineLabel } from "../labels";
import { WineProfileSchema } from "../types";
import { defineCommand, notFound, type CommandContext } from "./core";

const SetWineProfileInput = z.object({
  wineId: z.string().min(1),
  /** The written profile, or null to remove it ("Remove" on About this wine). */
  profile: WineProfileSchema.nullable(),
});

export const setWineProfileCommand = defineCommand({
  name: "setWineProfile",
  description: 'Set or remove a wine\'s AI-written "About this wine" profile.',
  input: SetWineProfileInput,
  async execute({ wineId, profile }, changes) {
    const wine = await changes.get("wines", wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    await changes.update("wines", wineId, { profile });
    return {
      summary: profile
        ? `Wrote a profile for ${wineLabel(wine)}`
        : `Removed the profile for ${wineLabel(wine)}`,
    };
  },
});

export const setWineProfile = (input: z.input<typeof SetWineProfileInput>, ctx?: CommandContext) =>
  setWineProfileCommand.run(input, ctx);
