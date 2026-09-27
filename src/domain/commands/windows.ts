import { z } from "zod";
import { wineLabel } from "../labels";
import { WindowSourceSchema, YearSchema } from "../types";
import { cleanText, CommandError, defineCommand, notFound, type CommandContext } from "./core";
import { windowRange } from "../window";

const SetWindowInput = z.object({
  wineId: z.string().min(1),
  from: YearSchema.nullable().describe("First year to drink, or null"),
  to: YearSchema.nullable().describe("Last year to drink, or null"),
  source: WindowSourceSchema.describe('"ai" for an estimate, "user" when the user set it'),
  note: z.string().nullable().optional().describe("Short reason for the window"),
  overwrite: z
    .boolean()
    .optional()
    .describe("Must be true to replace a window the user set themselves"),
});

export const USER_WINDOW_MESSAGE =
  "You set this wine's drinking window yourself. Confirm to replace it.";

export const setDrinkingWindowCommand = defineCommand({
  name: "setDrinkingWindow",
  description:
    "Set or clear a wine's drinking window. An AI or import window never replaces one the user set unless overwrite is true.",
  input: SetWindowInput,
  async execute(input, changes) {
    const wine = await changes.get("wines", input.wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    if (input.from !== null && input.to !== null && input.to < input.from) {
      throw new CommandError("The drinking window ends before it starts.", "invalid-input");
    }
    const userSet =
      wine.windowSource === "user" && (wine.windowFrom !== null || wine.windowTo !== null);
    if (input.source !== "user" && userSet && !input.overwrite) {
      throw new CommandError(USER_WINDOW_MESSAGE);
    }
    const cleared = input.from === null && input.to === null;
    await changes.update("wines", wine.id, {
      windowFrom: input.from,
      windowTo: input.to,
      windowSource: cleared ? null : input.source,
      windowNote: cleared ? null : cleanText(input.note),
    });
    const range = cleared ? "none" : windowRange(input.from, input.to);
    return {
      summary: cleared
        ? `Cleared the drinking window for ${wineLabel(wine)}`
        : `Set drinking window for ${wineLabel(wine)} to ${range}`,
    };
  },
});

export const setDrinkingWindow = (input: z.input<typeof SetWindowInput>, ctx?: CommandContext) =>
  setDrinkingWindowCommand.run(input, ctx);
