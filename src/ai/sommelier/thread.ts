import { z } from "zod";
import { db } from "../../db/db";
import { nowIso } from "../../domain/clock";
import type { ChatMessage, ChatThread } from "../../domain/types";
import { newId } from "../../lib/id";

/**
 * Sommelier threads and messages in IndexedDB (KTD12). Each stored row is one API message
 * (context, user text, assistant reply, tool results) or a notice shown only in the app. Rows
 * are append-only in what they send to Claude; only `meta` (card status and so on) changes.
 */

export const PROPOSAL_STATUSES = [
  "pending",
  "applied",
  "declined",
  "expired",
  "stale",
  "failed",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_KINDS = [
  "add",
  "consume",
  "move",
  "adjust",
  "update-wine",
  "set-window",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const ProposalSchema = z.object({
  kind: z.enum(PROPOSAL_KINDS),
  /** Registry command name the proposal runs on confirm. */
  command: z.string(),
  /** The command input, with references resolved to ids. */
  input: z.record(z.string(), z.unknown()),
  title: z.string(),
  /** What will change, one line each. */
  lines: z.array(z.string()),
  wineId: z.string().nullable(),
  /**
   * The target wine's updatedAt when the card was made (update-wine and set-window cards).
   * A different value on confirm means the wine changed since, so the card is stale.
   */
  expectedUpdatedAt: z.string().optional(),
  status: z.enum(PROPOSAL_STATUSES),
  /** The page session that created the card; cards from an earlier session expire. */
  sessionId: z.string(),
  /** Summary when applied, or the reason it was not. */
  outcome: z.string().nullable(),
  batchId: z.string().nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

const ToolResultSchema = z.object({ content: z.string(), isError: z.boolean() });
export type StoredToolResult = z.infer<typeof ToolResultSchema>;

const ToolRecordSchema = z.object({
  /** The tool_use block id. */
  id: z.string(),
  name: z.string(),
  /** Short line for the UI, for example "Searched cellar: 3 matches". */
  chip: z.string().nullable(),
  /** Wines to show as cards (show_bottles). */
  wineIds: z.array(z.string()),
  proposal: ProposalSchema.nullable(),
  /** The tool_result to send; null while a card waits for the user. */
  result: ToolResultSchema.nullable(),
});
export type ToolRecord = z.infer<typeof ToolRecordSchema>;

const MessageMetaSchema = z.object({
  kind: z.enum(["context", "user", "assistant", "tool-results", "notice"]),
  /** Assistant rows with tool calls: the tool round within the user's turn (1-based). */
  round: z.number().int().optional(),
  tools: z.array(ToolRecordSchema).optional(),
  /** Notice rows. */
  text: z.string().optional(),
  tone: z.enum(["info", "error"]).optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;
export type MessageKind = MessageMeta["kind"];

export interface StoredMessage extends ChatMessage {
  meta: MessageMeta;
}

/** Reads a row's meta; rows from a hand-edited backup that do not fit are shown as notices. */
export function readMeta(row: ChatMessage): MessageMeta {
  const parsed = MessageMetaSchema.safeParse(row.meta);
  if (parsed.success) return parsed.data;
  return { kind: "notice", text: "A message could not be read.", tone: "error" };
}

export async function createThread(title = ""): Promise<ChatThread> {
  const t = nowIso();
  const thread: ChatThread = { id: newId(), createdAt: t, updatedAt: t, title };
  await db.chatThreads.add(thread);
  return thread;
}

export async function getThread(threadId: string): Promise<ChatThread | undefined> {
  return db.chatThreads.get(threadId);
}

/** Threads, most recently used first. */
export async function listThreads(): Promise<ChatThread[]> {
  return db.chatThreads.orderBy("updatedAt").reverse().toArray();
}

/** A thread's rows in order. */
export async function listMessages(threadId: string): Promise<StoredMessage[]> {
  const rows = await db.chatMessages
    .where("[threadId+createdAt]")
    .between([threadId, ""], [threadId, "￿"])
    .toArray();
  return rows.map((row) => ({ ...row, meta: readMeta(row) }));
}

export async function appendMessage(
  threadId: string,
  role: "user" | "assistant",
  content: ChatMessage["content"],
  meta: MessageMeta,
): Promise<StoredMessage> {
  const t = nowIso();
  const row: StoredMessage = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    threadId,
    role,
    content,
    meta,
  };
  await db.transaction("rw", db.chatMessages, db.chatThreads, async () => {
    await db.chatMessages.add(row);
    await db.chatThreads.update(threadId, { updatedAt: t });
  });
  return row;
}

export async function appendNotice(
  threadId: string,
  text: string,
  tone: "info" | "error" = "info",
): Promise<StoredMessage> {
  return appendMessage(threadId, "assistant", "", { kind: "notice", text, tone });
}

export async function updateMeta(messageId: string, meta: MessageMeta): Promise<void> {
  await db.chatMessages.update(messageId, { meta, updatedAt: nowIso() });
}

/** Sets the thread title from the first question, if it has none yet. */
export async function titleThread(threadId: string, question: string): Promise<void> {
  const thread = await db.chatThreads.get(threadId);
  if (!thread || thread.title) return;
  const oneLine = question.replace(/\s+/g, " ").trim();
  const title = oneLine.length > 60 ? `${oneLine.slice(0, 57).trimEnd()}…` : oneLine;
  await db.chatThreads.update(threadId, { title });
}
