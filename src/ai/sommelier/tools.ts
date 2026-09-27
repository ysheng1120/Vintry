import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { CommandName } from "../../domain/commands";
import {
  PROPOSAL_TOOLS,
  proposalToolDescription,
  proposalToolSchemas,
  type ProposalToolName,
} from "./proposals";
import { readToolDescriptions, readToolSchemas, type ReadToolName } from "./readTools";

/**
 * The sommelier's tool list (KTD11): read tools over the selectors, and proposal tools whose
 * schemas come from the command registry's zod inputs. The list is built once and sorted by
 * name so its bytes never change between requests, which keeps the prompt cache warm.
 * `eager_input_streaming` stays off: inputs are a few ids and numbers, so the API's own input
 * validation is worth more than streaming them; every input is still checked with zod.
 */

/**
 * Registry commands the sommelier never calls, with the reason. Together with the registry's
 * own `humanOnly` commands and PROPOSAL_TOOLS, this covers every command (the parity test
 * in src/domain/parity.test.ts checks it).
 */
export const CHAT_HUMAN_ONLY: Partial<Record<CommandName, string>> = {
  importRows: "Bulk CSV import needs the import preview, so only the collector starts it.",
  deleteWine: "Deleting a wine is left to the collector, from the wine's page.",
  restoreWine: "Bringing back a deleted wine is done by the collector from History.",
  addTastingNote: "Tasting notes are the collector's own words; the note helper drafts them.",
  updateTastingNote: "Tasting notes are the collector's own words.",
  deleteTastingNote: "Removing a tasting note is left to the collector.",
  createLocation: "Locations are set up by the collector (a new name in an add card creates one).",
  renameLocation: "Locations are managed by the collector on the Locations page.",
  deleteLocation: "Locations are managed by the collector on the Locations page.",
  addWishlistItem: "The wishlist is kept by the collector.",
  updateWishlistItem: "The wishlist is kept by the collector.",
  removeWishlistItem: "The wishlist is kept by the collector.",
  convertWishlistItem: "Turning a wishlist item into bottles is done from the wishlist.",
  mergeWines: "Merging wines is done by the collector from the wine's page.",
  loadSampleCellar: "The sample cellar is loaded by the collector from onboarding or Settings.",
  clearSampleCellar: "The sample cellar is cleared by the collector.",
  setWineProfile: "The wine profile is written by the About this wine button.",
  setWineCritics:
    "What critics say is researched on the web only when the collector asks, from the wine's page.",
  setWinePrices:
    "Suggested prices are researched on the web only when the collector asks, from the wine's page.",
};

/** Commands the sommelier can propose, by tool name. */
export const CHAT_TOOL_COMMANDS: Record<string, CommandName> = Object.fromEntries(
  Object.entries(PROPOSAL_TOOLS).map(([tool, { command }]) => [tool, command]),
);

function inputSchema(schema: z.ZodType): BetaTool["input_schema"] {
  const json: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: "input" }) };
  delete json.$schema;
  return { ...json, type: "object" };
}

function buildTools(): BetaTool[] {
  const read = (Object.keys(readToolSchemas) as ReadToolName[]).map((name): BetaTool => ({
    name,
    description: readToolDescriptions[name],
    input_schema: inputSchema(readToolSchemas[name]),
  }));
  const proposals = (Object.keys(proposalToolSchemas) as ProposalToolName[]).map(
    (name): BetaTool => ({
      name,
      description: proposalToolDescription(name),
      input_schema: inputSchema(proposalToolSchemas[name]),
    }),
  );
  return [...read, ...proposals].sort((a, b) => a.name.localeCompare(b.name));
}

let cached: BetaTool[] | null = null;

/** Every sommelier tool, sorted by name. The same array (and bytes) on every call. */
export function sommelierTools(): BetaTool[] {
  cached ??= buildTools();
  return cached;
}
