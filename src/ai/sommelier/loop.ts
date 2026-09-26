import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getSetting, SETTING_KEYS } from "../../db/settings";
import type { CommandResult, WineDraft } from "../../domain/commands";
import type { ChatMessage } from "../../domain/types";
import { newId } from "../../lib/id";
import { sendMessage } from "../client";
import { toAiError } from "../errors";
import { buildCellarSnapshot, describeScreen, type ScreenContext } from "./context";
import { systemBlocks, type PromptSettings } from "./prompt";
import { applyProposal, isProposalTool, prepareProposal } from "./proposals";
import { isReadTool, runReadTool } from "./readTools";
import { endRun, isBusy, setStreamText, startRun } from "./runState";
import {
  appendMessage,
  appendNotice,
  createThread,
  listMessages,
  titleThread,
  updateMeta,
  type ProposalStatus,
  type StoredMessage,
  type StoredToolResult,
  type ToolRecord,
} from "./thread";
import { sommelierTools } from "./tools";

/**
 * The sommelier tool loop (KTD11, KTD12). It runs in the browser and keeps every step in
 * IndexedDB, so a thread survives navigation and reloads:
 * - each user turn appends a context message (cellar snapshot, current screen), then the text;
 * - read tools run at once; proposal tools become confirm cards and the loop pauses;
 * - every tool_use gets a tool_result in the next user message, sent once all cards in that
 *   response are confirmed, declined or expired;
 * - at most MAX_TOOL_ROUNDS tool rounds run per user turn.
 */

export const MAX_TOOL_ROUNDS = 8;
export const EXPIRED_RESULT = "Proposal expired, not applied";
export const DECLINED_RESULT = "User declined";
export const ROUND_CAP_NOTICE = `The sommelier stopped after ${MAX_TOOL_ROUNDS} steps without finishing. Try asking again, perhaps more narrowly.`;
export const REFUSAL_NOTICE = "Claude declined to answer that. Try rewording your question.";
const MAX_TOKENS = 16000;

/** This page load. Cards made in an earlier session expire when their thread is opened. */
export const SESSION_ID = newId();

// ---------- building requests ----------

const CACHE = { type: "ephemeral" } as const;

function blocksOf(row: StoredMessage): BetaContentBlockParam[] {
  if (typeof row.content === "string") return [{ type: "text", text: row.content }];
  // Stored blocks are exactly what was sent or received (assistant blocks are passed back as
  // returned, thinking blocks included).
  return structuredClone(row.content) as unknown as BetaContentBlockParam[];
}

function withCache(block: BetaContentBlockParam): BetaContentBlockParam {
  return { ...block, cache_control: CACHE } as BetaContentBlockParam;
}

/**
 * The API messages for a thread: notices are left out and consecutive rows of one role are
 * joined. Cache breakpoints go on the latest cellar snapshot and on the last block.
 */
export function buildMessages(rows: StoredMessage[]): BetaMessageParam[] {
  const sent = rows.filter((row) => row.meta.kind !== "notice");
  const lastContext = sent.findLastIndex((row) => row.meta.kind === "context");
  const messages: BetaMessageParam[] = [];
  sent.forEach((row, index) => {
    const blocks = blocksOf(row);
    if (index === lastContext && blocks[0]) blocks[0] = withCache(blocks[0]);
    const previous = messages.at(-1);
    if (previous && previous.role === row.role && Array.isArray(previous.content)) {
      previous.content.push(...blocks);
    } else {
      messages.push({ role: row.role, content: blocks });
    }
  });
  const last = messages.at(-1);
  if (last?.role === "user" && Array.isArray(last.content)) {
    const end = last.content.length - 1;
    const block = last.content[end];
    if (block && !("cache_control" in block && block.cache_control)) {
      last.content[end] = withCache(block);
    }
  }
  return messages;
}

async function promptSettings(): Promise<PromptSettings> {
  const currency = await getSetting<unknown>(SETTING_KEYS.currency, "GBP");
  return {
    locale: (typeof navigator !== "undefined" && navigator.language) || "en-GB",
    currency: typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "GBP",
  };
}

async function turnContext(screen: ScreenContext | undefined): Promise<BetaTextBlockParam[]> {
  const blocks: BetaTextBlockParam[] = [{ type: "text", text: await buildCellarSnapshot() }];
  const screenLine = await describeScreen(screen);
  if (screenLine) blocks.push({ type: "text", text: screenLine });
  return blocks;
}

// ---------- tool calls ----------

function toolResultBlocks(records: ToolRecord[]): BetaToolResultBlockParam[] {
  return records.map((record) => ({
    type: "tool_result",
    tool_use_id: record.id,
    content: record.result?.content ?? EXPIRED_RESULT,
    ...(record.result?.isError ? { is_error: true } : {}),
  }));
}

async function appendToolResults(threadId: string, records: ToolRecord[]): Promise<void> {
  await appendMessage(
    threadId,
    "user",
    toolResultBlocks(records) as unknown as ChatMessage["content"],
    { kind: "tool-results" },
  );
}

async function handleToolUse(block: BetaToolUseBlock): Promise<ToolRecord> {
  const record: ToolRecord = {
    id: block.id,
    name: block.name,
    chip: null,
    wineIds: [],
    proposal: null,
    result: null,
  };
  if (isReadTool(block.name)) {
    const outcome = await runReadTool(block.name, block.input);
    return {
      ...record,
      chip: outcome.chip,
      wineIds: outcome.wineIds,
      result: { content: outcome.content, isError: outcome.isError },
    };
  }
  if (isProposalTool(block.name)) {
    const prepared = await prepareProposal(block.name, block.input);
    if (prepared.kind === "result") return { ...record, result: prepared.result };
    return {
      ...record,
      proposal: {
        ...prepared.card,
        status: "pending",
        sessionId: SESSION_ID,
        outcome: null,
        batchId: null,
      },
    };
  }
  return { ...record, result: { content: `There is no tool named ${block.name}.`, isError: true } };
}

// ---------- running rounds ----------

/**
 * Sends requests until Claude ends its turn, a card waits for the collector, or the round cap
 * is reached. `roundsDone` counts the tool rounds already used in this user turn.
 */
async function runRounds(threadId: string, roundsDone: number, signal: AbortSignal) {
  const settings = await promptSettings();
  let rounds = roundsDone;
  for (;;) {
    const rows = await listMessages(threadId);
    setStreamText(threadId, "");
    const response = await sendMessage(
      {
        feature: "chat",
        system: systemBlocks(settings),
        tools: sommelierTools(),
        messages: buildMessages(rows),
        effort: "medium",
        maxTokens: MAX_TOKENS,
      },
      { signal, onText: (_delta, snapshot) => setStreamText(threadId, snapshot) },
    );
    const content = response.content as unknown as ChatMessage["content"];
    const toolUses = response.content.filter(
      (block): block is BetaToolUseBlock => block.type === "tool_use",
    );

    // Check why Claude stopped before running anything.
    if (response.stop_reason === "refusal") {
      await appendNotice(threadId, REFUSAL_NOTICE, "error");
      return;
    }
    if (response.stop_reason === "max_tokens") {
      // A reply cut off mid tool call is not kept: its tools must not run.
      if (toolUses.length === 0) {
        await appendMessage(threadId, "assistant", content, { kind: "assistant" });
      }
      await appendNotice(
        threadId,
        "The answer was too long and got cut off. Try asking again.",
        "error",
      );
      return;
    }
    if (toolUses.length === 0) {
      await appendMessage(threadId, "assistant", content, { kind: "assistant" });
      setStreamText(threadId, "");
      return;
    }

    rounds += 1;
    // Tool calls only read (proposals become cards, written below), so they can run together.
    const records = await Promise.all(toolUses.map(handleToolUse));
    await appendMessage(threadId, "assistant", content, {
      kind: "assistant",
      round: rounds,
      tools: records,
    });
    setStreamText(threadId, "");
    if (records.some((record) => record.result === null)) return; // waiting for the collector

    await appendToolResults(threadId, records);
    if (rounds >= MAX_TOOL_ROUNDS) {
      await appendNotice(threadId, ROUND_CAP_NOTICE, "error");
      return;
    }
  }
}

/** Runs rounds as one busy run of the thread; errors become notices in the thread. */
async function run(threadId: string, roundsDone: number, signal: AbortSignal): Promise<void> {
  try {
    await runRounds(threadId, roundsDone, signal);
  } catch (thrown) {
    const error = toAiError(thrown);
    await appendNotice(
      threadId,
      error.kind === "aborted" ? "Stopped." : error.message,
      error.kind === "aborted" ? "info" : "error",
    );
  } finally {
    endRun(threadId);
  }
}

// ---------- locking ----------

const locks = new Map<string, Promise<unknown>>();

/** Runs thread updates one at a time, so two quick card clicks cannot both send results. */
function withLock<T>(threadId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(threadId) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(
    threadId,
    next.catch(() => undefined),
  );
  return next;
}

/** The last assistant row that still waits for card decisions, if any. */
function waitingRow(rows: StoredMessage[]): StoredMessage | undefined {
  const last = rows.findLast((row) => row.meta.kind === "assistant");
  return last?.meta.tools?.some((record) => record.result === null) ? last : undefined;
}

/**
 * Expires waiting cards in a thread: each gets the tool_result "Proposal expired, not
 * applied", and the results message is appended. With `onlyEarlierSessions`, only cards from
 * an earlier page load expire (used when a thread is opened).
 */
async function expireWaiting(threadId: string, onlyEarlierSessions: boolean): Promise<void> {
  const row = waitingRow(await listMessages(threadId));
  const tools = row?.meta.tools;
  if (!row || !tools) return;
  const pending = tools.filter((record) => record.result === null);
  if (onlyEarlierSessions && pending.some((record) => record.proposal?.sessionId === SESSION_ID)) {
    return;
  }
  const expired = tools.map((record): ToolRecord => {
    if (record.result !== null) return record;
    return {
      ...record,
      proposal: record.proposal && {
        ...record.proposal,
        status: "expired",
        outcome: EXPIRED_RESULT,
      },
      result: { content: EXPIRED_RESULT, isError: false },
    };
  });
  await updateMeta(row.id, { ...row.meta, tools: expired });
  await appendToolResults(threadId, expired);
}

/** Call when a thread is opened: cards left from an earlier session expire (R15). */
export function expireStaleProposals(threadId: string): Promise<void> {
  return withLock(threadId, () => expireWaiting(threadId, true));
}

// ---------- public API ----------

export class SommelierBusyError extends Error {
  constructor() {
    super("The sommelier is still answering. Wait a moment, or stop it first.");
    this.name = "SommelierBusyError";
  }
}

export interface SendOptions {
  screen?: ScreenContext;
}

/**
 * Sends the collector's message and runs the turn. Waiting cards expire first. Resolves when
 * the turn ends or pauses for a card; failures show as notices in the thread.
 */
export async function sendUserMessage(
  threadId: string,
  text: string,
  options: SendOptions = {},
): Promise<void> {
  const question = text.trim();
  if (!question) return;
  if (isBusy(threadId)) throw new SommelierBusyError();
  const signal = startRun(threadId);
  try {
    await withLock(threadId, async () => {
      await expireWaiting(threadId, false);
      await appendMessage(
        threadId,
        "user",
        (await turnContext(options.screen)) as unknown as ChatMessage["content"],
        { kind: "context" },
      );
      await appendMessage(threadId, "user", question, { kind: "user" });
      await titleThread(threadId, question);
    });
  } catch (error) {
    endRun(threadId);
    throw error;
  }
  await run(threadId, 0, signal);
}

/** Starts a new thread with a first question. `done` settles when the first turn ends. */
export async function askInNewThread(
  text: string,
  options: SendOptions = {},
): Promise<{ threadId: string; done: Promise<void> }> {
  const thread = await createThread();
  return { threadId: thread.id, done: sendUserMessage(thread.id, text, options) };
}

export type Decision = { confirm: false } | { confirm: true; drafts?: WineDraft[] };

export interface ResolveOutcome {
  status: ProposalStatus;
  /** The command result when applied (for the Undo toast). */
  result: CommandResult | null;
  /** Why it was not applied, in plain words. */
  message: string | null;
  /** Settles when the conversation has continued (or immediately if other cards still wait). */
  next: Promise<void>;
}

const DONE = Promise.resolve();

/**
 * Confirms or declines a card. A confirmed card is re-checked and applied through its command
 * (source "ai-chat"); the stored result becomes its tool_result. When no card in the response
 * is left waiting, the results are sent and the conversation continues.
 */
export async function resolveProposal(
  threadId: string,
  toolUseId: string,
  decision: Decision,
): Promise<ResolveOutcome> {
  const outcome = await withLock(threadId, async () => {
    const rows = await listMessages(threadId);
    const row = rows.find((r) => r.meta.tools?.some((t) => t.id === toolUseId));
    const tools = row?.meta.tools ?? [];
    const record = tools.find((t) => t.id === toolUseId);
    const proposal = record?.proposal;
    if (!row || !record || !proposal || record.result !== null || proposal.status !== "pending") {
      return {
        status: proposal?.status ?? "expired",
        result: null,
        message: "This card is no longer waiting for an answer.",
        continueFrom: null,
      };
    }
    if (proposal.sessionId !== SESSION_ID) {
      await expireWaiting(threadId, false);
      return {
        status: "expired" as const,
        result: null,
        message: EXPIRED_RESULT,
        continueFrom: null,
      };
    }

    let status: ProposalStatus;
    let result: CommandResult | null = null;
    let message: string | null = null;
    let toolResult: StoredToolResult;
    if (!decision.confirm) {
      status = "declined";
      toolResult = { content: DECLINED_RESULT, isError: false };
    } else {
      const applied = await applyProposal(proposal, decision.drafts);
      status = applied.status;
      toolResult = applied.toolResult;
      if (applied.status === "applied") result = applied.result;
      else message = applied.reason;
    }

    const updated = tools.map((t): ToolRecord =>
      t.id === toolUseId
        ? {
            ...t,
            result: toolResult,
            proposal: {
              ...proposal,
              status,
              outcome: result?.summary ?? message ?? (status === "declined" ? "Declined" : null),
              batchId: result?.batchId ?? null,
            },
          }
        : t,
    );
    await updateMeta(row.id, { ...row.meta, tools: updated });
    const allAnswered = updated.every((t) => t.result !== null);
    if (allAnswered) await appendToolResults(threadId, updated);
    return { status, result, message, continueFrom: allAnswered ? (row.meta.round ?? 1) : null };
  });

  let next = DONE;
  if (outcome.continueFrom !== null) {
    if (outcome.continueFrom >= MAX_TOOL_ROUNDS) {
      next = appendNotice(threadId, ROUND_CAP_NOTICE, "error").then(() => undefined);
    } else if (!isBusy(threadId)) {
      next = run(threadId, outcome.continueFrom, startRun(threadId));
    }
  }
  return { status: outcome.status, result: outcome.result, message: outcome.message, next };
}
