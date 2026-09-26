import { z } from "zod";
import { db } from "../../db/db";
import { newId } from "../../lib/id";
import { nowIso } from "../clock";
import { bottles } from "../labels";
import { normalizeName } from "../match";
import { CommandError, defineCommand, notFound, type CommandContext } from "./core";

function locationName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new CommandError("A location needs a name.", "invalid-input");
  return trimmed;
}

async function refuseDuplicate(name: string, exceptId?: string) {
  const key = normalizeName(name);
  const clash = (await db.locations.toArray()).find(
    (l) => l.id !== exceptId && normalizeName(l.name) === key,
  );
  if (clash) throw new CommandError(`A location called "${clash.name}" already exists.`);
}

const CreateInput = z.object({
  name: z.string().describe('Location name, for example "Kitchen rack"'),
  notes: z.string().nullable().optional(),
});

export const createLocationCommand = defineCommand({
  name: "createLocation",
  description: "Create a storage location such as a rack or a wine fridge.",
  input: CreateInput,
  async execute(input, changes) {
    const name = locationName(input.name);
    await refuseDuplicate(name);
    const t = nowIso();
    await changes.insert("locations", {
      id: newId(),
      createdAt: t,
      updatedAt: t,
      name,
      notes: input.notes?.trim() || null,
      isSample: false,
    });
    return { summary: `Created location ${name}` };
  },
});

const RenameInput = z.object({ locationId: z.string().min(1), name: z.string() });

export const renameLocationCommand = defineCommand({
  name: "renameLocation",
  description: "Rename a storage location.",
  input: RenameInput,
  async execute(input, changes) {
    const location = await changes.get("locations", input.locationId);
    if (!location) throw notFound("location");
    const name = locationName(input.name);
    await refuseDuplicate(name, location.id);
    await changes.update("locations", location.id, { name });
    return { summary: `Renamed location ${location.name} to ${name}` };
  },
});

export const deleteLocationCommand = defineCommand({
  name: "deleteLocation",
  description: "Delete an empty storage location. Refused while it still holds bottles.",
  input: z.object({ locationId: z.string().min(1) }),
  async execute({ locationId }, changes) {
    const location = await changes.get("locations", locationId);
    if (!location) throw notFound("location");
    const openLots = await db.lots
      .where("locationId")
      .equals(locationId)
      .filter((lot) => lot.quantity > 0)
      .toArray();
    const held = openLots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (held > 0) {
      throw new CommandError(
        `${location.name} still holds ${bottles(held)}. Move or drink them first.`,
      );
    }
    await changes.remove("locations", locationId);
    return { summary: `Deleted location ${location.name}` };
  },
});

export const createLocation = (input: z.input<typeof CreateInput>, ctx?: CommandContext) =>
  createLocationCommand.run(input, ctx);
export const renameLocation = (input: z.input<typeof RenameInput>, ctx?: CommandContext) =>
  renameLocationCommand.run(input, ctx);
export const deleteLocation = (input: { locationId: string }, ctx?: CommandContext) =>
  deleteLocationCommand.run(input, ctx);
