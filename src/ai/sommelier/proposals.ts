import { z } from "zod";
import { db } from "../../db/db";
import {
  addBottlesCommand,
  adjustQuantityCommand,
  commands,
  CommandError,
  consumeBottlesCommand,
  moveBottlesCommand,
  setDrinkingWindowCommand,
  updateWineCommand,
  type Command,
  type CommandName,
  type CommandResult,
  type WineDraft,
} from "../../domain/commands";
import { bottles, wineLabel } from "../../domain/labels";
import { getCellarList } from "../../domain/selectors";
import type { Lot, Wine } from "../../domain/types";
import { pluralize } from "../../lib/format";
import { openLotsByWine } from "./readTools";
import type { Proposal, ProposalKind, StoredToolResult } from "./thread";
import { windowRange } from "../../domain/window";

/**
 * Proposal tools (KTD11): each one is a registry command whose input schema becomes the tool
 * schema. Calling one shows the collector a confirm card; nothing is written until they
 * confirm. Lot tools also accept a wine id or the wine's name, and return candidates instead
 * of guessing when that is ambiguous.
 */

const LOT_TARGET = {
  lotId: z
    .string()
    .optional()
    .describe("Lot id from the snapshot, search_cellar or get_wine. Preferred."),
  wineId: z
    .string()
    .optional()
    .describe("Wine id, when you do not know the lot. Several open lots return candidates."),
  wineQuery: z
    .string()
    .optional()
    .describe(
      "What the collector called the wine, when you have no id. Several matching wines or lots return candidates; then ask which one.",
    ),
};

export const proposalToolSchemas = {
  propose_add_bottles: addBottlesCommand.input,
  propose_consume: consumeBottlesCommand.input.omit({ lotId: true }).extend(LOT_TARGET),
  propose_move: moveBottlesCommand.input.omit({ lotId: true }).extend(LOT_TARGET),
  propose_adjust_quantity: adjustQuantityCommand.input.omit({ lotId: true }).extend(LOT_TARGET),
  // The collector's own market value is never something the sommelier may propose.
  propose_update_wine: updateWineCommand.input.extend({
    patch: updateWineCommand.input.shape.patch.omit({ valuePerBottle: true, valueCurrency: true }),
  }),
  propose_set_drinking_window: setDrinkingWindowCommand.input,
} as const;

export type ProposalToolName = keyof typeof proposalToolSchemas;

/** Which registry command each proposal tool runs, and its card kind. */
export const PROPOSAL_TOOLS: Record<
  ProposalToolName,
  { command: CommandName; kind: ProposalKind }
> = {
  propose_add_bottles: { command: "addBottles", kind: "add" },
  propose_consume: { command: "consumeBottles", kind: "consume" },
  propose_move: { command: "moveBottles", kind: "move" },
  propose_adjust_quantity: { command: "adjustQuantity", kind: "adjust" },
  propose_update_wine: { command: "updateWine", kind: "update-wine" },
  propose_set_drinking_window: { command: "setDrinkingWindow", kind: "set-window" },
};

const CONFIRM_NOTE =
  "This only proposes the change: the collector sees a confirm card and nothing changes until they confirm. The tool result says whether it was applied.";

export function proposalToolDescription(name: ProposalToolName): string {
  const command = commands[PROPOSAL_TOOLS[name].command] as Command;
  return `${command.description} ${CONFIRM_NOTE}`;
}

export function isProposalTool(name: string): name is ProposalToolName {
  return Object.hasOwn(PROPOSAL_TOOLS, name);
}

/** A card ready to show, before it gets a status and session. */
export type CardDraft = Pick<
  Proposal,
  "kind" | "command" | "input" | "title" | "lines" | "wineId" | "expectedUpdatedAt"
>;

export type Prepared =
  { kind: "card"; card: CardDraft } | { kind: "result"; result: StoredToolResult };

const result = (content: unknown, isError = false): Prepared => ({
  kind: "result",
  result: { content: typeof content === "string" ? content : JSON.stringify(content), isError },
});

// ---------- candidates ----------

async function wineCandidates(wines: Wine[]) {
  const lots = await openLotsByWine(wines.map((w) => w.id));
  return wines.map((wine) => ({
    wineId: wine.id,
    wine: wineLabel(wine),
    lots: lots.get(wine.id) ?? [],
  }));
}

async function locationName(id: string | null): Promise<string> {
  if (!id) return "no location";
  return (await db.locations.get(id))?.name ?? "Unknown location";
}

function lotPlace(name: string, bin: string | null): string {
  return bin ? `${name}, bin ${bin}` : name;
}

// ---------- lot targets ----------

type LotTarget = { lotId?: string; wineId?: string; wineQuery?: string };

/** The command input without the lot target fields (the card holds the resolved lot id). */
function withoutTarget<T extends LotTarget>(input: T): Omit<T, keyof LotTarget> {
  const rest: Record<string, unknown> = { ...input };
  delete rest.lotId;
  delete rest.wineId;
  delete rest.wineQuery;
  return rest as Omit<T, keyof LotTarget>;
}
type Resolved = { lot: Lot; wine: Wine } | { prepared: Prepared };

async function resolveLot(target: LotTarget, { allowClosed = false } = {}): Promise<Resolved> {
  if (target.lotId) {
    const lot = await db.lots.get(target.lotId);
    const wine = lot ? await db.wines.get(lot.wineId) : undefined;
    if (!lot || !wine || wine.deletedAt) {
      return {
        prepared: result(
          `No lot has id ${target.lotId}. Nothing was changed. Read the cellar again.`,
          true,
        ),
      };
    }
    if (lot.quantity === 0 && !allowClosed) {
      return {
        prepared: result(`That lot of ${wineLabel(wine)} is empty. Nothing was changed.`, true),
      };
    }
    return { lot, wine };
  }

  let wines: Wine[];
  if (target.wineId) {
    const wine = await db.wines.get(target.wineId);
    if (!wine || wine.deletedAt) {
      return { prepared: result(`No wine has id ${target.wineId}. Nothing was changed.`, true) };
    }
    wines = [wine];
  } else if (target.wineQuery?.trim()) {
    wines = (await getCellarList({ search: target.wineQuery })).map((row) => row.wine);
    if (wines.length === 0) {
      return {
        prepared: result(
          `No bottles in the cellar match "${target.wineQuery}". Nothing was changed.`,
          true,
        ),
      };
    }
  } else {
    return { prepared: result("Give lotId, wineId or wineQuery. Nothing was changed.", true) };
  }

  const candidates = await wineCandidates(wines);
  const openLots = candidates.flatMap((c) => c.lots);
  if (wines.length === 1 && openLots.length === 1) {
    const [only] = openLots;
    const lot = only ? await db.lots.get(only.lotId) : undefined;
    if (lot && wines[0]) return { lot, wine: wines[0] };
  }
  if (openLots.length === 0) {
    return {
      prepared: result(
        `${wineLabel(wines[0] as Wine)} has no bottles left. Nothing was changed.`,
        true,
      ),
    };
  }
  const what =
    wines.length > 1
      ? `${pluralize(wines.length, "wine")} match`
      : `${wineLabel(wines[0] as Wine)} has ${pluralize(openLots.length, "open lot")}`;
  return {
    prepared: result({
      status: "needs_choice",
      message: `${what}. Nothing was changed. Ask the collector which one they mean, then propose again with its lotId.`,
      candidates,
    }),
  };
}

async function quantityChanged(lot: Lot, wine: Wine, expected: number): Promise<Prepared> {
  return result({
    status: "quantity_changed",
    message: `This lot of ${wineLabel(wine)} now holds ${bottles(lot.quantity)}, not ${expected}. Nothing was changed. Check with the collector before proposing again.`,
    candidates: await wineCandidates([wine]),
  });
}

/**
 * Resolves the lot a change targets, then checks the count the model expected and, unless
 * `allowAnyQuantity`, that the lot holds enough bottles. Returns the lot or a tool result.
 */
async function resolveForChange(
  input: LotTarget & { quantity: number; expectedQuantity?: number },
  { allowClosed = false, allowAnyQuantity = false } = {},
): Promise<Resolved> {
  const resolved = await resolveLot(input, { allowClosed });
  if ("prepared" in resolved) return resolved;
  const { lot, wine } = resolved;
  if (input.expectedQuantity !== undefined && input.expectedQuantity !== lot.quantity) {
    return { prepared: await quantityChanged(lot, wine, input.expectedQuantity) };
  }
  if (!allowAnyQuantity && input.quantity > lot.quantity) {
    return {
      prepared: result(
        `Only ${bottles(lot.quantity)} left in that lot. Nothing was changed.`,
        true,
      ),
    };
  }
  return resolved;
}

// ---------- preparing cards ----------

function invalid(name: string, error: z.ZodError): Prepared {
  const details = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`)
    .join("; ");
  return result(`Invalid input for ${name}: ${details}. Nothing was changed.`, true);
}

type In<N extends ProposalToolName> = z.output<(typeof proposalToolSchemas)[N]>;

async function prepareConsume(input: In<"propose_consume">): Promise<Prepared> {
  const resolved = await resolveForChange(input);
  if ("prepared" in resolved) return resolved.prepared;
  const { lot, wine } = resolved;
  const place = lotPlace(await locationName(lot.locationId), lot.bin);
  const lines = [
    `From ${place}: ${lot.quantity} now, ${lot.quantity - input.quantity} after`,
    ...(input.date ? [`Date: ${input.date}`] : []),
    ...(input.rating != null ? [`Rating: ${input.rating}/100`] : []),
    ...(input.occasion ? [`Occasion: ${input.occasion}`] : []),
    ...(input.note ? [`Note: ${input.note}`] : []),
  ];
  return {
    kind: "card",
    card: {
      kind: "consume",
      command: "consumeBottles",
      input: { ...withoutTarget(input), lotId: lot.id, expectedQuantity: lot.quantity },
      title: `Drink ${bottles(input.quantity)} of ${wineLabel(wine)}`,
      lines,
      wineId: wine.id,
    },
  };
}

async function prepareMove(input: In<"propose_move">): Promise<Prepared> {
  const resolved = await resolveForChange(input);
  if ("prepared" in resolved) return resolved.prepared;
  const { lot, wine } = resolved;
  if (input.toLocationId && !(await db.locations.get(input.toLocationId))) {
    const locations = await db.locations.toArray();
    return result({
      status: "unknown_location",
      message: `No location has id ${input.toLocationId}. Nothing was changed.`,
      locations: locations.map((l) => ({ locationId: l.id, name: l.name })),
    });
  }
  const from = lotPlace(await locationName(lot.locationId), lot.bin);
  const to = lotPlace(await locationName(input.toLocationId), input.bin ?? null);
  const left = lot.quantity - input.quantity;
  return {
    kind: "card",
    card: {
      kind: "move",
      command: "moveBottles",
      input: { ...withoutTarget(input), lotId: lot.id, expectedQuantity: lot.quantity },
      title: `Move ${bottles(input.quantity)} of ${wineLabel(wine)}`,
      lines: [`From ${from} to ${to}`, ...(left > 0 ? [`${bottles(left)} stay at ${from}`] : [])],
      wineId: wine.id,
    },
  };
}

async function prepareAdjust(input: In<"propose_adjust_quantity">): Promise<Prepared> {
  const resolved = await resolveForChange(input, {
    allowClosed: Boolean(input.lotId),
    allowAnyQuantity: true,
  });
  if ("prepared" in resolved) return resolved.prepared;
  const { lot, wine } = resolved;
  if (input.quantity === lot.quantity) {
    return result(`That lot already holds ${bottles(lot.quantity)}. Nothing was changed.`, true);
  }
  const place = lotPlace(await locationName(lot.locationId), lot.bin);
  return {
    kind: "card",
    card: {
      kind: "adjust",
      command: "adjustQuantity",
      input: { ...withoutTarget(input), lotId: lot.id, expectedQuantity: lot.quantity },
      title: `Correct the count of ${wineLabel(wine)}`,
      lines: [
        `At ${place}: ${lot.quantity} now, ${input.quantity} after`,
        "A correction, not recorded as drinking",
      ],
      wineId: wine.id,
    },
  };
}

const FIELD_LABELS: Record<string, string> = {
  producer: "Producer",
  name: "Name",
  vintage: "Vintage",
  colour: "Colour",
  country: "Country",
  region: "Region",
  appellation: "Appellation",
  grapes: "Grapes",
  bottleSize: "Bottle size (ml)",
  windowFrom: "Drink from",
  windowTo: "Drink to",
  windowSource: "Window source",
  windowNote: "Window note",
  rating: "Your rating",
  tags: "Tags",
  notes: "Notes",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  return String(value);
}

async function liveWine(wineId: string): Promise<Wine | undefined> {
  const wine = await db.wines.get(wineId);
  return wine && !wine.deletedAt ? wine : undefined;
}

async function prepareUpdateWine(input: In<"propose_update_wine">): Promise<Prepared> {
  const wine = await liveWine(input.wineId);
  if (!wine) return result(`No wine has id ${input.wineId}. Nothing was changed.`, true);
  const fields: Record<string, unknown> = { ...input.patch };
  delete fields.thumbnail; // a label image cannot come from chat
  delete fields.valuePerBottle; // nor can the collector's own market value
  delete fields.valueCurrency;
  const patch = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => value !== undefined && show(value) !== show(wine[key as keyof Wine]),
    ),
  );
  const keys = Object.keys(patch);
  if (keys.length === 0) return result("That would change nothing. Nothing was changed.", true);
  return {
    kind: "card",
    card: {
      kind: "update-wine",
      command: "updateWine",
      input: { wineId: wine.id, patch },
      expectedUpdatedAt: wine.updatedAt,
      title: `Edit ${wineLabel(wine)}`,
      lines: keys.map(
        (key) =>
          `${FIELD_LABELS[key] ?? key}: ${show(wine[key as keyof Wine])} → ${show(patch[key])}`,
      ),
      wineId: wine.id,
    },
  };
}

function rangeText(from: number | null, to: number | null): string {
  return from === null && to === null ? "none" : windowRange(from, to);
}

async function prepareSetWindow(input: In<"propose_set_drinking_window">): Promise<Prepared> {
  const wine = await liveWine(input.wineId);
  if (!wine) return result(`No wine has id ${input.wineId}. Nothing was changed.`, true);
  if (input.from !== null && input.to !== null && input.to < input.from) {
    return result("The window ends before it starts. Nothing was changed.", true);
  }
  const userSet =
    wine.windowSource === "user" && (wine.windowFrom !== null || wine.windowTo !== null);
  const lines = [
    `Drinking window: ${rangeText(wine.windowFrom, wine.windowTo)} → ${rangeText(input.from, input.to)}`,
    ...(input.source === "ai" ? ["Marked as an AI estimate"] : []),
    ...(input.note ? [`Why: ${input.note}`] : []),
    ...(userSet && input.source !== "user" ? ["Replaces the window you set yourself"] : []),
  ];
  return {
    kind: "card",
    card: {
      kind: "set-window",
      command: "setDrinkingWindow",
      // Confirming a card that warned about it is the collector's go-ahead to replace their
      // window. A window they set after the card was made is caught as stale on confirm.
      input: { ...input, overwrite: userSet },
      expectedUpdatedAt: wine.updatedAt,
      title: `Set the drinking window for ${wineLabel(wine)}`,
      lines,
      wineId: wine.id,
    },
  };
}

async function prepareAdd(input: In<"propose_add_bottles">): Promise<Prepared> {
  for (const draft of input.drafts) {
    if (draft.wineId && !(await liveWine(draft.wineId))) {
      return result(`No wine has id ${draft.wineId}. Nothing was changed.`, true);
    }
  }
  const count = input.drafts.reduce(
    (sum, d) => sum + d.lots.reduce((s, lot) => s + lot.quantity, 0),
    0,
  );
  return {
    kind: "card",
    card: {
      kind: "add",
      command: "addBottles",
      input: { drafts: input.drafts },
      title: `Add ${bottles(count)}`,
      lines: input.drafts.map((d) =>
        wineLabel({ producer: d.producer, name: d.name ?? "", vintage: d.vintage }),
      ),
      wineId: input.drafts.length === 1 ? (input.drafts[0]?.wineId ?? null) : null,
    },
  };
}

/** Validates a proposal tool call and builds its card, or returns a result without a card. */
export async function prepareProposal(
  name: ProposalToolName,
  rawInput: unknown,
): Promise<Prepared> {
  const parsed = proposalToolSchemas[name].safeParse(rawInput);
  if (!parsed.success) return invalid(name, parsed.error);
  switch (name) {
    case "propose_consume":
      return prepareConsume(parsed.data as In<"propose_consume">);
    case "propose_move":
      return prepareMove(parsed.data as In<"propose_move">);
    case "propose_adjust_quantity":
      return prepareAdjust(parsed.data as In<"propose_adjust_quantity">);
    case "propose_update_wine":
      return prepareUpdateWine(parsed.data as In<"propose_update_wine">);
    case "propose_set_drinking_window":
      return prepareSetWindow(parsed.data as In<"propose_set_drinking_window">);
    case "propose_add_bottles":
      return prepareAdd(parsed.data as In<"propose_add_bottles">);
  }
}

// ---------- applying a confirmed card ----------

export type ApplyOutcome =
  | { status: "applied"; result: CommandResult; toolResult: StoredToolResult }
  | { status: "stale" | "failed"; reason: string; toolResult: StoredToolResult };

/** The stored state after a change, for the tool result: touched lots and wines as saved. */
async function storedState(res: CommandResult) {
  const lots = (await db.lots.bulkGet(res.touched.lotIds)).filter((l) => l !== undefined);
  const wines = (await db.wines.bulkGet(res.touched.wineIds)).filter((w) => w !== undefined);
  const open = await openLotsByWine(wines.map((w) => w.id));
  return {
    status: "applied",
    summary: res.summary,
    lots: await Promise.all(
      lots.map(async (lot) => ({
        lotId: lot.id,
        wineId: lot.wineId,
        bottles: lot.quantity,
        location: lot.locationId ? await locationName(lot.locationId) : null,
        bin: lot.bin,
      })),
    ),
    wines: wines.map((wine) => ({
      wineId: wine.id,
      wine: wineLabel(wine),
      bottlesLeft: (open.get(wine.id) ?? []).reduce((sum, lot) => sum + lot.bottles, 0),
      window: rangeText(wine.windowFrom, wine.windowTo),
    })),
  };
}

type Stale = { toolResult: StoredToolResult; reason: string };

function gone(content: string): Stale {
  return { toolResult: { content, isError: true }, reason: content };
}

async function checkPreconditions(proposal: Proposal): Promise<Stale | null> {
  const { input } = proposal;
  if (typeof input.lotId === "string" && typeof input.expectedQuantity === "number") {
    const lot = await db.lots.get(input.lotId);
    const wine = lot ? await db.wines.get(lot.wineId) : undefined;
    if (!lot || !wine || wine.deletedAt) {
      return gone("That lot no longer exists. Nothing was changed.");
    }
    if (lot.quantity !== input.expectedQuantity) {
      const stale = await quantityChanged(lot, wine, input.expectedQuantity);
      if (stale.kind === "result") {
        return { toolResult: stale.result, reason: "The bottles changed since this was proposed." };
      }
    }
  }
  if (typeof input.wineId === "string") {
    const wine = await liveWine(input.wineId);
    if (!wine) return gone("That wine no longer exists. Nothing was changed.");
    if (proposal.expectedUpdatedAt !== undefined && wine.updatedAt !== proposal.expectedUpdatedAt) {
      return {
        toolResult: {
          content: JSON.stringify({
            status: "wine_changed",
            message: `${wineLabel(wine)} was changed since this was proposed. Nothing was changed. Read it again with get_wine and check with the collector before proposing again.`,
          }),
          isError: false,
        },
        reason: "The wine changed since this was proposed.",
      };
    }
  }
  return null;
}

/**
 * Re-checks a confirmed card against the stored data, then runs its command with source
 * "ai-chat". Add cards take the drafts as the collector finished them in the card.
 */
export async function applyProposal(
  proposal: Proposal,
  drafts?: WineDraft[],
): Promise<ApplyOutcome> {
  const stale = await checkPreconditions(proposal);
  if (stale) return { status: "stale", ...stale };
  const command = commands[proposal.command as CommandName] as Command | undefined;
  if (!command || command.humanOnly) {
    const reason = "The sommelier cannot run this change.";
    return { status: "failed", reason, toolResult: { content: reason, isError: true } };
  }
  const input = proposal.kind === "add" && drafts ? { drafts } : proposal.input;
  try {
    const res = await command.run(input, { source: "ai-chat" });
    return {
      status: "applied",
      result: res,
      toolResult: { content: JSON.stringify(await storedState(res)), isError: false },
    };
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    return {
      status: "failed",
      reason: error.message,
      toolResult: { content: `Not applied: ${error.message}`, isError: true },
    };
  }
}
