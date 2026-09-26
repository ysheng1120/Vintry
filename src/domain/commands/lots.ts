import { z } from "zod";
import { newId } from "../../lib/id";
import { nowIso } from "../clock";
import { bottles, wineLabel } from "../labels";
import { cleanText, CommandError, defineCommand, notFound, type CommandContext } from "./core";
import { expectedQuantityField, openLotWithAtLeast } from "./consumption";

const MoveInput = z.object({
  lotId: z.string().min(1).describe("Lot id to move bottles from"),
  quantity: z.number().int().min(1).describe("Bottles to move"),
  toLocationId: z.string().nullable().describe("Target location id, or null for no location"),
  bin: z.string().nullable().optional().describe("Bin or shelf at the target"),
  expectedQuantity: expectedQuantityField,
});

export const moveBottlesCommand = defineCommand({
  name: "moveBottles",
  description:
    "Move bottles to another location. Moving part of a lot splits it into a new lot at the target.",
  input: MoveInput,
  async execute(input, changes) {
    const lot = await openLotWithAtLeast(
      changes,
      input.lotId,
      input.quantity,
      input.expectedQuantity,
    );
    const wine = await changes.get("wines", lot.wineId);
    if (!wine) throw notFound("wine");
    const target = input.toLocationId ? await changes.get("locations", input.toLocationId) : null;
    if (input.toLocationId && !target) throw notFound("location");
    const bin = input.bin === undefined ? null : cleanText(input.bin);

    if (input.quantity === lot.quantity) {
      if (lot.locationId === input.toLocationId && lot.bin === bin) {
        throw new CommandError("These bottles are already there.");
      }
      await changes.update("lots", lot.id, { locationId: input.toLocationId, bin });
    } else {
      await changes.update("lots", lot.id, { quantity: lot.quantity - input.quantity });
      const t = nowIso();
      await changes.insert("lots", {
        ...lot,
        id: newId(),
        createdAt: t,
        updatedAt: t,
        locationId: input.toLocationId,
        bin,
        quantity: input.quantity,
        closedAt: null,
        splitFromLotId: lot.id,
      });
    }
    const where = target ? ` to ${target.name}` : " out of its location";
    return { summary: `Moved ${bottles(input.quantity)} of ${wineLabel(wine)}${where}` };
  },
});

const AdjustInput = z.object({
  lotId: z.string().min(1).describe("Lot id"),
  quantity: z.number().int().min(0).describe("The correct bottle count for this lot"),
  expectedQuantity: expectedQuantityField,
});

export const adjustQuantityCommand = defineCommand({
  name: "adjustQuantity",
  description:
    "Correct a lot's bottle count (for example a miscount or a broken bottle). Not a drink; no history entry.",
  input: AdjustInput,
  async execute(input, changes) {
    const lot = await changes.get("lots", input.lotId);
    if (!lot) throw notFound("lot");
    if (input.expectedQuantity !== undefined && lot.quantity !== input.expectedQuantity) {
      throw new CommandError(
        `This lot now holds ${bottles(lot.quantity)}, not ${input.expectedQuantity}.`,
      );
    }
    const wine = await changes.get("wines", lot.wineId);
    if (!wine) throw notFound("wine");
    await changes.update("lots", lot.id, {
      quantity: input.quantity,
      closedAt: input.quantity === 0 ? (lot.closedAt ?? nowIso()) : null,
    });
    return { summary: `Set ${wineLabel(wine)} to ${bottles(input.quantity)}` };
  },
});

export const moveBottles = (input: z.input<typeof MoveInput>, ctx?: CommandContext) =>
  moveBottlesCommand.run(input, ctx);
export const adjustQuantity = (input: z.input<typeof AdjustInput>, ctx?: CommandContext) =>
  adjustQuantityCommand.run(input, ctx);
