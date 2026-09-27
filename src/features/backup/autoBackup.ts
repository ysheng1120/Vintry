import { useSyncExternalStore } from "react";
import { exportBackup, markBackupDone, type BackupFile } from "../../db/backup";
import { db } from "../../db/db";
import { getSetting } from "../../db/settings";
import { formatDate, pluralize } from "../../lib/format";

/**
 * Automatic backups to a folder on disk. The local launcher's server (server/autoBackupPlugin.ts)
 * offers two routes; hosted builds and the dev server have neither, and then everything here
 * stays silent and the manual backups and reminders carry on as before.
 */
export const AUTO_BACKUP_URL = "/__vintry/backup";
export const AUTO_BACKUP_STATUS_URL = "/__vintry/backup/status";

/** A backup runs this long after the last change. */
export const AUTO_BACKUP_DELAY_MS = 60_000;
/** After a failed backup, try again this long later. */
export const AUTO_BACKUP_RETRY_MS = 5 * 60_000;
/** Keep in step with AUTO_BACKUPS_KEPT in server/autoBackupPlugin.ts. */
export const AUTO_BACKUPS_KEPT = 30;

/** After a change, a backup is read and kept ready this soon, for a tab that closes. */
export const AUTO_BACKUP_PREPARE_MS = 2_000;

// Browsers cap a keepalive request's body at 64 KiB. A larger backup is sent as a normal
// request, which still finishes while a tab is only hidden; one that is closing loses it, and
// the next start catches up.
const KEEPALIVE_LIMIT_BYTES = 60_000;

// Raw keys (matching db/settings's SETTING_KEYS): the router smoke test mocks the settings module.
const CHANGES_KEY = "changesSinceBackup";
const LAST_BACKUP_KEY = "lastBackupAt";

export const LAUNCHER_STOPPED_MESSAGE =
  "Vintry's launcher window seems to be closed. Start Vintry again to keep saving backups.";
export const BACKUP_FAILED_MESSAGE = "Vintry couldn't save the backup file.";

export interface AutoBackupStatus {
  /** The folder on disk, as the launcher's server sees it. */
  folder: string;
  latest: { name: string; savedAt: string } | null;
  count: number;
}

export type AutoBackupState =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "on"; status: AutoBackupStatus; error: string | null };

// ---- a small store shared by the app shell's runner and the Backup page ----
let state: AutoBackupState = { kind: "checking" };
let check: Promise<AutoBackupState> | null = null;
const listeners = new Set<() => void>();

function setState(next: AutoBackupState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getAutoBackupState(): AutoBackupState {
  return state;
}

export function useAutoBackupState(): AutoBackupState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
}

/** Test hook: forget the result of the status check. */
export function resetAutoBackupForTests() {
  check = null;
  setState({ kind: "checking" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): AutoBackupStatus | null {
  if (!isRecord(value) || typeof value.folder !== "string" || typeof value.count !== "number") {
    return null;
  }
  const { latest } = value;
  if (latest === null) return { folder: value.folder, latest: null, count: value.count };
  if (!isRecord(latest) || typeof latest.name !== "string" || typeof latest.savedAt !== "string") {
    return null;
  }
  return {
    folder: value.folder,
    latest: { name: latest.name, savedAt: latest.savedAt },
    count: value.count,
  };
}

/**
 * Asks the launcher for the backup folder's status. Null when there is no launcher: a hosted
 * build or the dev server answers with the app's page (or 404), and offline it fails.
 */
async function fetchStatus(): Promise<AutoBackupStatus | null> {
  try {
    const response = await fetch(AUTO_BACKUP_STATUS_URL, {
      headers: { "X-Vintry-Backup": "1" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) return null;
    return parseStatus(await response.json());
  } catch {
    return null;
  }
}

/** Checks once per page load whether automatic backups are available. Never throws. */
export function checkAutoBackup(): Promise<AutoBackupState> {
  check ??= fetchStatus().then((status) => {
    setState(status ? { kind: "on", status, error: null } : { kind: "unavailable" });
    return state;
  });
  return check;
}

class AutoBackupError extends Error {}

/** A backup read ahead of time, so a closing tab can send it without waiting on the database. */
export interface PreparedBackup {
  backup: BackupFile;
  body: string;
}

export async function prepareBackup(): Promise<PreparedBackup> {
  const backup = await exportBackup();
  return { backup, body: JSON.stringify(backup) };
}

export interface RunOptions {
  /** Send with keepalive (when small enough), for a page being hidden or closed. */
  keepalive?: boolean;
  /** Send this instead of reading the database first. */
  prepared?: PreparedBackup;
}

async function postBackup(body: string, keepalive: boolean): Promise<AutoBackupStatus> {
  let response: Response;
  try {
    response = await fetch(AUTO_BACKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vintry-Backup": "1" },
      body,
      keepalive: keepalive && new Blob([body]).size <= KEEPALIVE_LIMIT_BYTES,
      cache: "no-store",
      // The page's own policy is no-referrer, which makes some browsers send "Origin: null"
      // on a POST; the launcher accepts only its own origin.
      referrerPolicy: "same-origin",
    });
  } catch {
    throw new AutoBackupError(LAUNCHER_STOPPED_MESSAGE);
  }
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(reply) && typeof reply.error === "string" ? reply.error : null;
    throw new AutoBackupError(message ?? BACKUP_FAILED_MESSAGE);
  }
  const status = parseStatus(reply);
  if (!status) throw new AutoBackupError(BACKUP_FAILED_MESSAGE);
  return status;
}

/**
 * Marks the backup done, the same way a manual backup does, but only when nothing changed
 * since `backup` was read: its change counter and last-backup time still match the live ones.
 */
export async function markBackupDoneIfCurrent(backup: BackupFile): Promise<boolean> {
  const saved = new Map(backup.data.settings.map((row) => [row.key, row.value]));
  return db.transaction("rw", db.settings, async () => {
    const changes = Number(await getSetting<number>(CHANGES_KEY, 0)) || 0;
    const lastBackupAt = await getSetting<string | null>(LAST_BACKUP_KEY, null);
    if (changes !== (Number(saved.get(CHANGES_KEY)) || 0)) return false;
    if (lastBackupAt !== (saved.get(LAST_BACKUP_KEY) ?? null)) return false;
    await markBackupDone();
    return true;
  });
}

/**
 * Sends one backup to the launcher. Returns whether it was saved (or already matched the newest
 * file). Never throws; a failure is kept in the store for the app shell's banner.
 */
export async function runAutoBackup({
  keepalive = false,
  prepared,
}: RunOptions = {}): Promise<boolean> {
  try {
    // With a prepared backup, the request starts before the first await: a closing page
    // still gets it out.
    const { backup, body } = prepared ?? (await prepareBackup());
    const status = await postBackup(body, keepalive);
    setState({ kind: "on", status, error: null });
    await markBackupDoneIfCurrent(backup);
    return true;
  } catch (error) {
    const message = error instanceof AutoBackupError ? error.message : BACKUP_FAILED_MESSAGE;
    if (state.kind === "on") setState({ ...state, error: message });
    return false;
  }
}

export interface ChangeSignal {
  changes: number;
  /** The newest event batch, with its undo state; null when the history is empty. */
  newestBatch: string | null;
  newestBatchAt: string | null;
}

/** What the runner watches: the change counter and the newest entry in the history. */
export async function readChangeSignal(): Promise<ChangeSignal> {
  const [changes, newest] = await Promise.all([
    getSetting<number>(CHANGES_KEY, 0),
    db.eventBatches.orderBy("createdAt").last(),
  ]);
  return {
    changes: Number(changes) || 0,
    newestBatch: newest ? `${newest.id}:${newest.undoneAt ?? ""}` : null,
    newestBatchAt: newest?.createdAt ?? null,
  };
}

/**
 * Whether the data changed between two signals. A counter going back to 0 is a finished backup,
 * not a change, so a backup never sets off another one.
 */
export function isNewChange(before: ChangeSignal, after: ChangeSignal): boolean {
  return after.changes > before.changes || after.newestBatch !== before.newestBatch;
}

/**
 * Whether to back up when Vintry starts: changes are waiting, or the history has something
 * newer than the newest file in the folder. An empty cellar with nothing saved yet waits for
 * its first change.
 */
export function needsBackupAtStart(signal: ChangeSignal, status: AutoBackupStatus): boolean {
  if (signal.changes > 0) return true;
  if (!signal.newestBatchAt) return false;
  if (!status.latest) return true;
  return new Date(signal.newestBatchAt).getTime() > new Date(status.latest.savedAt).getTime();
}

export interface AutoBackupScheduler {
  /** A change happened: back up once things have been quiet for the delay. */
  changed(): void;
  /** Backs up now if a change is waiting or the last try failed (the page is being hidden). */
  flushPending(options?: RunOptions): void;
  /** Backs up now. */
  runNow(): Promise<void>;
  dispose(): void;
}

/** Debounces backups: one at a time, `delayMs` after the last change, retrying after a failure. */
export function createAutoBackupScheduler(
  run: (options: RunOptions) => Promise<boolean>,
  { delayMs = AUTO_BACKUP_DELAY_MS, retryMs = AUTO_BACKUP_RETRY_MS } = {},
): AutoBackupScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let running = false;
  let again = false;
  let disposed = false;

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void start({});
    }, ms);
  }

  async function start(options: RunOptions): Promise<void> {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    pending = false;
    running = true;
    const ok = await run(options).catch(() => false);
    running = false;
    if (!ok) {
      pending = true;
      if (!timer && !disposed) schedule(retryMs);
    }
    if (again) {
      again = false;
      await start({});
    }
  }

  return {
    changed() {
      if (disposed) return;
      pending = true;
      schedule(delayMs);
    },
    flushPending(options = {}) {
      if (pending) void start(options);
    },
    runNow: () => start({}),
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

/** "just now", "5 minutes ago", "yesterday", or "on 3 Sept 2026". */
export function formatSavedAgo(iso: string, now: Date = new Date()): string {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(seconds)) return "at an unknown time";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${pluralize(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${pluralize(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${formatDate(iso)}`;
}
