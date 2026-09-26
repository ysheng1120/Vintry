import { z } from "zod";
import { db } from "../../db/db";
import { bumpChangesSinceBackup } from "../../db/settings";
import { nowIso } from "../clock";
import { ChangeSet, touchedFromChanges, type Touched } from "../events";
import type { EventSource } from "../types";
import { newId } from "../../lib/id";

export type { Touched } from "../events";

export type CommandErrorCode = "invalid-input" | "not-found" | "refused";

/** A command refused to run. The message is plain language, ready to show. Nothing was written. */
export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(message: string, code: CommandErrorCode = "refused") {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

export interface CommandContext {
  /** Who asked for the change. Defaults to "user" (or the command's own default). */
  source?: EventSource;
}

export interface CommandResult {
  /** The event batch to pass to `undoBatch`; null when the command had nothing to change. */
  batchId: string | null;
  touched: Touched;
  /** Plain-language summary, for example "Drank 1 bottle of Ridge Monte Bello 2019". */
  summary: string;
}

export interface Command<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Set when the AI must never run this command; the value says why. */
  humanOnly?: string;
  run(input: z.input<S>, ctx?: CommandContext): Promise<CommandResult>;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.map(String).join(".");
  return field ? `${field} ${issue.message}` : issue.message;
}

/** Validates command input, turning zod issues into one readable CommandError. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input, {
    error: (issue) => {
      if (issue.input === undefined) return "is required";
      if (issue.code === "too_small" && issue.origin === "string" && issue.minimum === 1) {
        return "must not be empty";
      }
      return undefined;
    },
  });
  if (!result.success) {
    const details = result.error.issues.slice(0, 3).map(describeIssue).join("; ");
    throw new CommandError(`Please check: ${details}.`, "invalid-input");
  }
  return result.data;
}

export function notFound(what: string): CommandError {
  return new CommandError(`That ${what} no longer exists.`, "not-found");
}

type CommitListener = (result: CommandResult) => void;
const commitListeners = new Set<CommitListener>();

/**
 * Subscribes to committed changes (a batch was written). The app shell uses this to ask the
 * browser for persistent storage after the first real write (R23). Returns an unsubscribe function.
 */
export function onCommandCommitted(listener: CommitListener): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

function notifyCommitted(result: CommandResult) {
  if (result.batchId === null) return;
  for (const listener of commitListeners) listener(result);
}

/** Tables every recorded command may write, in one transaction. */
const COMMAND_TABLES = () => [
  db.wines,
  db.lots,
  db.consumptions,
  db.tastingNotes,
  db.locations,
  db.wishlist,
  db.eventBatches,
  db.settings,
];

interface RecordedSpec<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  humanOnly?: string;
  /** Source used when the caller gives none. */
  defaultSource?: EventSource;
  /** Whether the change counts towards the backup reminder (R22). Default true. */
  countsAsChange?: boolean;
  execute(
    input: z.output<S>,
    changes: ChangeSet,
    ctx: { source: EventSource },
  ): Promise<{ summary: string }>;
}

/**
 * Defines a command that runs in one transaction and records one undoable event batch (KTD4).
 * If `execute` throws, the transaction rolls back and nothing is written.
 */
export function defineCommand<S extends z.ZodType>(spec: RecordedSpec<S>): Command<S> {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    ...(spec.humanOnly ? { humanOnly: spec.humanOnly } : {}),
    async run(rawInput, ctx) {
      const input = parseInput(spec.input, rawInput);
      const source = ctx?.source ?? spec.defaultSource ?? "user";
      const result = await db.transaction("rw", COMMAND_TABLES(), async () => {
        const changes = new ChangeSet();
        const { summary } = await spec.execute(input, changes, { source });
        const list = changes.list();
        if (list.length === 0) return { batchId: null, touched: touchedFromChanges([]), summary };

        const batchId = newId();
        const t = nowIso();
        await db.eventBatches.add({
          id: batchId,
          createdAt: t,
          updatedAt: t,
          source,
          command: spec.name,
          summary,
          changes: list,
          undoneAt: null,
          snapshotId: null,
        });
        if (spec.countsAsChange !== false) await bumpChangesSinceBackup();
        return { batchId, touched: touchedFromChanges(list), summary };
      });
      if (spec.countsAsChange !== false) notifyCommitted(result);
      return result;
    },
  };
}

/** Defines a command with its own write path (restore, wipe). Input is still validated. */
export function defineCustomCommand<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  input: S;
  humanOnly?: string;
  execute(input: z.output<S>, ctx: CommandContext): Promise<CommandResult>;
}): Command<S> {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    ...(spec.humanOnly ? { humanOnly: spec.humanOnly } : {}),
    async run(rawInput, ctx) {
      return spec.execute(parseInput(spec.input, rawInput), ctx ?? {});
    },
  };
}

/** Trims text; empty or missing becomes null. */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Builds the stored fields for an edit patch: skips undefined fields and trims every text field
 * (empty becomes null) except `producer` and `name`, which keep their validated value.
 */
export function cleanPatch<T>(patch: Record<string, unknown>): Partial<T> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[key] =
      typeof value === "string" && key !== "producer" && key !== "name" ? cleanText(value) : value;
  }
  return next as Partial<T>;
}
