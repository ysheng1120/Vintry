import { z } from "zod";
import { newId } from "../../lib/id";
import { nowIso } from "../clock";
import { ColourSchema, WishlistItemSchema, YearSchema, type WishlistItem } from "../types";
import {
  cleanPatch,
  cleanText,
  CommandError,
  defineCommand,
  notFound,
  type CommandContext,
} from "./core";
import { WineDraftSchema } from "./schemas";
import { addDrafts, addedSummary } from "./wines";

const WishlistFields = z.object({
  producer: z.string().trim().min(1),
  name: z.string().trim().optional(),
  vintage: YearSchema.nullable().optional(),
  colour: ColourSchema.nullable().optional(),
  country: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  targetPrice: z.number().min(0).nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
});

function itemLabel(item: Pick<WishlistItem, "producer" | "name" | "vintage">): string {
  return [item.producer, item.name, item.vintage ?? ""].filter((p) => String(p).trim()).join(" ");
}

export const addWishlistItemCommand = defineCommand({
  name: "addWishlistItem",
  description: "Add a wine the user wants to buy to the wishlist.",
  input: WishlistFields,
  async execute(input, changes) {
    const t = nowIso();
    const item = WishlistItemSchema.parse({
      id: newId(),
      createdAt: t,
      updatedAt: t,
      producer: input.producer,
      name: input.name ?? "",
      vintage: input.vintage ?? null,
      colour: input.colour ?? null,
      country: cleanText(input.country),
      region: cleanText(input.region),
      notes: cleanText(input.notes),
      targetPrice: input.targetPrice ?? null,
      currency: cleanText(input.currency),
    });
    await changes.insert("wishlist", item);
    return { summary: `Added ${itemLabel(item)} to the wishlist` };
  },
});

const UpdateInput = z.object({ itemId: z.string().min(1), patch: WishlistFields.partial() });

export const updateWishlistItemCommand = defineCommand({
  name: "updateWishlistItem",
  description: "Edit a wishlist item.",
  input: UpdateInput,
  async execute({ itemId, patch }, changes) {
    const item = await changes.get("wishlist", itemId);
    if (!item) throw notFound("wishlist item");
    const next = cleanPatch<WishlistItem>(patch);
    const updated = await changes.update("wishlist", itemId, next);
    return { summary: `Edited ${itemLabel(updated)} on the wishlist` };
  },
});

export const removeWishlistItemCommand = defineCommand({
  name: "removeWishlistItem",
  description: "Remove an item from the wishlist.",
  input: z.object({ itemId: z.string().min(1) }),
  async execute({ itemId }, changes) {
    const item = await changes.get("wishlist", itemId);
    if (!item) throw notFound("wishlist item");
    await changes.remove("wishlist", itemId);
    return { summary: `Removed ${itemLabel(item)} from the wishlist` };
  },
});

const ConvertInput = z.object({
  itemId: z.string().min(1),
  draft: WineDraftSchema,
});

export const convertWishlistItemCommand = defineCommand({
  name: "convertWishlistItem",
  description: "Turn a wishlist item into bottles in the cellar and take it off the wishlist.",
  input: ConvertInput,
  async execute({ itemId, draft }, changes, { source }) {
    const item = await changes.get("wishlist", itemId);
    if (!item) throw notFound("wishlist item");
    if (draft.lots.length === 0) {
      throw new CommandError(
        "Add at least one bottle to move it into the cellar.",
        "invalid-input",
      );
    }
    const outcome = await addDrafts(changes, [draft], source);
    await changes.remove("wishlist", itemId);
    return { summary: `${addedSummary(outcome)} from the wishlist` };
  },
});

export const addWishlistItem = (input: z.input<typeof WishlistFields>, ctx?: CommandContext) =>
  addWishlistItemCommand.run(input, ctx);
export const updateWishlistItem = (input: z.input<typeof UpdateInput>, ctx?: CommandContext) =>
  updateWishlistItemCommand.run(input, ctx);
export const removeWishlistItem = (input: { itemId: string }, ctx?: CommandContext) =>
  removeWishlistItemCommand.run(input, ctx);
export const convertWishlistItem = (input: z.input<typeof ConvertInput>, ctx?: CommandContext) =>
  convertWishlistItemCommand.run(input, ctx);
