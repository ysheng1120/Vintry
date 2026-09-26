import { z } from "zod";
import { toIsoDate } from "../../lib/format";
import { newId } from "../../lib/id";
import { now, nowIso } from "../clock";
import { wineLabel } from "../labels";
import { IsoDateSchema, RatingSchema, type TastingNote } from "../types";
import { CommandError, defineCommand, notFound, type CommandContext } from "./core";

function noteText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new CommandError("A tasting note can't be empty.", "invalid-input");
  return trimmed;
}

const AddNoteInput = z.object({
  wineId: z.string().min(1),
  text: z.string().describe("The tasting note"),
  rating: RatingSchema.nullable().optional(),
  date: IsoDateSchema.optional().describe("YYYY-MM-DD; default today"),
  consumptionId: z.string().nullable().optional().describe("The drink this note belongs to"),
});

export const addTastingNoteCommand = defineCommand({
  name: "addTastingNote",
  description: "Add a tasting note to a wine.",
  input: AddNoteInput,
  async execute(input, changes) {
    const wine = await changes.get("wines", input.wineId);
    if (!wine || wine.deletedAt) throw notFound("wine");
    if (input.consumptionId && !(await changes.get("consumptions", input.consumptionId))) {
      throw notFound("drink");
    }
    const t = nowIso();
    await changes.insert("tastingNotes", {
      id: newId(),
      createdAt: t,
      updatedAt: t,
      wineId: wine.id,
      consumptionId: input.consumptionId ?? null,
      date: input.date ?? toIsoDate(now()),
      text: noteText(input.text),
      rating: input.rating ?? null,
      isSample: false,
    });
    return { summary: `Added a tasting note for ${wineLabel(wine)}` };
  },
});

const UpdateNoteInput = z.object({
  noteId: z.string().min(1),
  text: z.string().optional(),
  rating: RatingSchema.nullable().optional(),
  date: IsoDateSchema.optional(),
});

export const updateTastingNoteCommand = defineCommand({
  name: "updateTastingNote",
  description: "Edit a tasting note's text, rating or date.",
  input: UpdateNoteInput,
  async execute(input, changes) {
    const note = await changes.get("tastingNotes", input.noteId);
    if (!note) throw notFound("tasting note");
    const patch: Partial<TastingNote> = {};
    if (input.text !== undefined) patch.text = noteText(input.text);
    if (input.rating !== undefined) patch.rating = input.rating;
    if (input.date !== undefined) patch.date = input.date;
    await changes.update("tastingNotes", note.id, patch);
    const wine = await changes.get("wines", note.wineId);
    return { summary: `Edited a tasting note${wine ? ` for ${wineLabel(wine)}` : ""}` };
  },
});

export const deleteTastingNoteCommand = defineCommand({
  name: "deleteTastingNote",
  description: "Delete a tasting note.",
  input: z.object({ noteId: z.string().min(1) }),
  async execute({ noteId }, changes) {
    const note = await changes.get("tastingNotes", noteId);
    if (!note) throw notFound("tasting note");
    await changes.remove("tastingNotes", noteId);
    const wine = await changes.get("wines", note.wineId);
    return { summary: `Deleted a tasting note${wine ? ` for ${wineLabel(wine)}` : ""}` };
  },
});

export const addTastingNote = (input: z.input<typeof AddNoteInput>, ctx?: CommandContext) =>
  addTastingNoteCommand.run(input, ctx);
export const updateTastingNote = (input: z.input<typeof UpdateNoteInput>, ctx?: CommandContext) =>
  updateTastingNoteCommand.run(input, ctx);
export const deleteTastingNote = (input: { noteId: string }, ctx?: CommandContext) =>
  deleteTastingNoteCommand.run(input, ctx);
