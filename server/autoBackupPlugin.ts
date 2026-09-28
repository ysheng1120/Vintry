// Automatic backups for the local launcher (`vite preview` on http://localhost:47821).
// The app posts its backup JSON here; this writes it to a folder on disk. Only the preview
// server gets these routes: the hosted builds and the dev server have no backup endpoint, and
// the app then keeps to its manual backups.
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { LAUNCHER_PORT } from "../src/config/securityHeaders.ts";
import { BackupFileSchema } from "../src/db/backup-schema.ts";
import { CURRENT_SCHEMA_VERSION } from "../src/db/migrations.ts";

export const BACKUP_ROUTE = "/__vintry/backup";
export const STATUS_ROUTE = "/__vintry/backup/status";

// Which automatic backup files stay in the folder. A file kept by any tier survives; every other
// automatic backup file is deleted. One shared pool of "the newest N" is not enough: every
// browser writes here about a minute after each change and when its tab closes, so a second
// browser or a test profile could push every good backup out within minutes. The calendar tiers
// can't be flooded that way: however many files land today, older days keep their file.
// At most 20 + 14 + 8 + 12 = 54 files, usually fewer because the tiers overlap.
/** The newest files, whatever their date: undo for the last few sessions of changes. */
export const RECENT_BACKUPS_KEPT = 20;
/** The newest file of each of the last 14 calendar days (today included): two weeks, by day. */
export const DAILY_BACKUPS_KEPT = 14;
/** The newest file of each of the last 8 ISO weeks (this week included): about two months. */
export const WEEKLY_BACKUPS_KEPT = 8;
/** The newest file of each of the last 12 calendar months (this month included): a year. */
export const MONTHLY_BACKUPS_KEPT = 12;
/** Largest backup body accepted. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const FOLDER_NAME = "Vintry Backups";
/** Only files with exactly this name are ever counted, compared, or deleted. */
const BACKUP_NAME_PATTERN = /^vintry-backup-(\d{4})-(\d{2})-(\d{2})-\d{6}\.json$/;

// The launcher's own address, by name and by number. Checking Host guards against DNS
// rebinding (another site's name pointed at 127.0.0.1); checking Origin guards against other
// pages, including other local servers, posting here.
const ALLOWED_HOSTS = [`localhost:${LAUNCHER_PORT}`, `127.0.0.1:${LAUNCHER_PORT}`];
const ALLOWED_ORIGINS = ALLOWED_HOSTS.map((host) => `http://${host}`);

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

interface Refusal {
  status: number;
  error: string;
}

export interface AutoBackupStatus {
  folder: string;
  latest: { name: string; savedAt: string } | null;
  count: number;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where backups go: VINTRY_BACKUP_DIR if set; else "Vintry Backups" in the Documents folder
 * (OneDrive's Documents on Windows when it has one); else "Vintry Backups" in the home folder.
 */
export function resolveBackupDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  exists: (path: string) => boolean = isDirectory,
): string {
  const override = env.VINTRY_BACKUP_DIR?.trim();
  if (override) return resolve(override);
  if (platform === "win32" && env.OneDrive) {
    const oneDriveDocuments = join(env.OneDrive, "Documents");
    if (exists(oneDriveDocuments)) return join(oneDriveDocuments, FOLDER_NAME);
  }
  const documents = join(home, "Documents");
  if (exists(documents)) return join(documents, FOLDER_NAME);
  return join(home, FOLDER_NAME);
}

const two = (n: number) => String(n).padStart(2, "0");

/** The server's own file name for a backup, in local time: vintry-backup-2026-09-27-143005.json. */
export function autoBackupFileName(date: Date): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `vintry-backup-${day}-${time}.json`;
}

/** Host and Origin must be the launcher's, and the request must carry the app's marker header. */
export function checkRequest(req: IncomingMessage): Refusal | null {
  const refused = { status: 403, error: "Refused." };
  if (!ALLOWED_HOSTS.includes(req.headers.host ?? "")) return refused;
  if (req.headers["x-vintry-backup"] !== "1") return refused;
  const origin = req.headers.origin;
  if (origin !== undefined) return ALLOWED_ORIGINS.includes(origin) ? null : refused;
  // Browsers send Origin on every POST. A same-origin GET has none; then the fetch metadata,
  // when the browser sends it, must say same-origin.
  if (req.method !== "GET") return refused;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" ? null : refused;
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

class TooLargeError extends Error {}

/** Reads the whole body, stopping as soon as it passes `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.pause();
        reject(new TooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

const DAY_MS = 86_400_000;

/** A calendar date as "YYYY-MM-DD". `utc` holds the date at midnight UTC. */
function dayKey(utc: Date): string {
  return `${utc.getUTCFullYear()}-${two(utc.getUTCMonth() + 1)}-${two(utc.getUTCDate())}`;
}

/** The ISO week a calendar date falls in, as "YYYY-Www" (weeks start on Monday). */
function isoWeekKey(utc: Date): string {
  const thursday = new Date(utc.getTime() + (4 - (utc.getUTCDay() || 7)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${two(week)}`;
}

/** A month counted from year 0, so months compare and subtract as numbers. */
function monthIndex(utc: Date): number {
  return utc.getUTCFullYear() * 12 + utc.getUTCMonth();
}

/**
 * The automatic backup files to keep out of `names`, by the tiers above. Dates come from the
 * server's own file names, which are in local time, never from file times; `now` is read in
 * local time too. Names that aren't automatic backup files are never in the result, and never
 * pruned either (see backupsToPrune).
 */
export function selectBackupsToKeep(names: readonly string[], now: Date): Set<string> {
  const backups = names
    .flatMap((name) => {
      const match = BACKUP_NAME_PATTERN.exec(name);
      if (!match) return [];
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return [{ name, date }];
    })
    // Newest first: the names sort by time.
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  const keep = new Set(backups.slice(0, RECENT_BACKUPS_KEPT).map(({ name }) => name));
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const daysBefore = (days: number) => new Date(today.getTime() - days * DAY_MS);

  // Each calendar tier keeps the newest file of every period from its first period on. Keys
  // compare as text ("2026-09-27", "2026-W39") or as numbers (months). A file dated after `now`
  // (the clock was set back) is kept as well: keeping too much is the safe side.
  const tiers: { key: (date: Date) => string | number; from: string | number }[] = [
    { key: dayKey, from: dayKey(daysBefore(DAILY_BACKUPS_KEPT - 1)) },
    { key: isoWeekKey, from: isoWeekKey(daysBefore((WEEKLY_BACKUPS_KEPT - 1) * 7)) },
    { key: monthIndex, from: monthIndex(today) - (MONTHLY_BACKUPS_KEPT - 1) },
  ];
  for (const { key, from } of tiers) {
    const seen = new Set<string | number>();
    for (const { name, date } of backups) {
      const period = key(date);
      if (period < from || seen.has(period)) continue;
      seen.add(period);
      keep.add(name);
    }
  }
  return keep;
}

/** The automatic backup files in `names` that no tier keeps. Other names are never included. */
export function backupsToPrune(names: readonly string[], now: Date): string[] {
  const keep = selectBackupsToKeep(names, now);
  return names.filter((name) => BACKUP_NAME_PATTERN.test(name) && !keep.has(name));
}

/** Names of the automatic backup files in `dir`, oldest first (the names sort by time). */
async function listBackupNames(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && BACKUP_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function readStatus(dir: string): Promise<AutoBackupStatus> {
  const names = await listBackupNames(dir);
  const newest = names.at(-1);
  if (!newest) return { folder: dir, latest: null, count: 0 };
  const { mtime } = await stat(join(dir, newest));
  return {
    folder: dir,
    latest: { name: newest, savedAt: mtime.toISOString() },
    count: names.length,
  };
}

/** A backup without its exported-at time, so two exports of the same data compare equal. */
function withoutTimestamp(backup: Record<string, unknown>): string {
  return JSON.stringify({ ...backup, exportedAt: null });
}

/**
 * How many of the collector's own wines a backup holds: sample wines don't count, wines in the
 * bin (soft-deleted, still restorable) do. 0 for a file that isn't shaped like a backup.
 */
function ownWineCount(backup: Record<string, unknown>): number {
  const data = backup.data;
  if (typeof data !== "object" || data === null) return 0;
  const wines = (data as Record<string, unknown>).wines;
  if (!Array.isArray(wines)) return 0;
  return wines.filter(
    (wine) =>
      typeof wine === "object" &&
      wine !== null &&
      (wine as { isSample?: unknown }).isSample !== true,
  ).length;
}

/** A saved backup file as an object, or null when it can't be read or parsed. */
async function readSaved(path: string): Promise<Record<string, unknown> | null> {
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
    return saved as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Writes to a temporary file in the same folder, flushes it to disk, then renames it into place. */
async function writeAtomically(dir: string, name: string, text: string): Promise<void> {
  const temp = join(dir, `.vintry-backup-${randomBytes(8).toString("hex")}.tmp`);
  try {
    const file = await open(temp, "wx");
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, join(dir, name));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  // Flush the rename too where the system allows it (Windows cannot open a folder this way).
  try {
    const folder = await open(dir, "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  } catch {
    // The file itself is already safely written.
  }
}

/** Deletes the automatic backup files no tier keeps. Never touches any other file. */
async function pruneBackups(dir: string, now: Date): Promise<void> {
  for (const name of backupsToPrune(await listBackupNames(dir), now)) {
    await unlink(join(dir, name)).catch(() => {});
  }
}

/** Why a backup was not written: it matched the newest file, or it was empty and that wasn't. */
export type SkipReason = "unchanged" | "empty";

/**
 * Saves `backup` unless it matches the newest saved file apart from its exported-at time, or it
 * holds none of the collector's own wines while the newest saved file does. The second rule
 * keeps an empty cellar (a new browser profile, a test profile with only the sample wines, a
 * wiped database) from filling the folder and pushing good backups out: the newest file stays
 * the last one with wines in it. An empty backup is still saved into a folder with no backups
 * yet, or when the newest file is empty too. The file name comes from the clock only, never
 * from the request.
 */
export async function saveBackup(
  dir: string,
  backup: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ written: boolean; skipped?: SkipReason }> {
  await mkdir(dir, { recursive: true });
  const newest = (await listBackupNames(dir)).at(-1);
  const saved = newest ? await readSaved(join(dir, newest)) : null;
  if (saved) {
    if (withoutTimestamp(saved) === withoutTimestamp(backup)) {
      return { written: false, skipped: "unchanged" };
    }
    if (ownWineCount(backup) === 0 && ownWineCount(saved) > 0) {
      return { written: false, skipped: "empty" };
    }
  }
  await writeAtomically(dir, autoBackupFileName(now), JSON.stringify(backup, null, 2));
  try {
    await pruneBackups(dir, now);
  } catch {
    // The new backup is saved; failing to tidy older copies is not a failed backup.
  }
  return { written: true };
}

/** A file-system error in words the collector can act on. */
export function describeWriteError(error: unknown): string {
  switch ((error as NodeJS.ErrnoException | null)?.code) {
    case "ENOSPC":
      return "The disk is full. Free up some space so Vintry can save backups.";
    case "EACCES":
    case "EPERM":
      return "Vintry is not allowed to save files in the backup folder.";
    case "EROFS":
      return "The backup folder can't be written to.";
    default:
      return "Vintry couldn't save the backup file.";
  }
}

function isBackup(value: unknown): value is Record<string, unknown> {
  const parsed = BackupFileSchema.safeParse(value);
  return parsed.success && parsed.data.schemaVersion <= CURRENT_SCHEMA_VERSION;
}

export interface AutoBackupOptions {
  dir: string;
  /** Test hook for the clock that names files. */
  now?: () => Date;
}

/** The two backup routes as connect middleware. Everything else passes through. */
export function createAutoBackupMiddleware({
  dir,
  now = () => new Date(),
}: AutoBackupOptions): Middleware {
  // One save at a time, so comparing with the newest file and pruning never race each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isJsonContentType(req.headers["content-type"])) {
      sendJson(res, 415, { error: "Send the backup as JSON." });
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BACKUP_BYTES) {
      res.setHeader("Connection", "close");
      sendJson(res, 413, { error: "This backup is too large to save automatically." });
      return;
    }
    let text: string;
    try {
      text = await readBody(req, MAX_BACKUP_BYTES);
    } catch (error) {
      res.setHeader("Connection", "close");
      if (error instanceof TooLargeError) {
        sendJson(res, 413, { error: "This backup is too large to save automatically." });
      } else {
        sendJson(res, 400, { error: "The backup didn't arrive in full." });
      }
      return;
    }
    let backup: unknown;
    try {
      backup = JSON.parse(text);
    } catch {
      backup = null;
    }
    if (!isBackup(backup)) {
      sendJson(res, 400, { error: "This is not a Vintry backup." });
      return;
    }
    try {
      const result = await serially(() => saveBackup(dir, backup, now()));
      sendJson(res, 200, { ...result, ...(await readStatus(dir)) });
    } catch (error) {
      sendJson(res, (error as NodeJS.ErrnoException).code === "ENOSPC" ? 507 : 500, {
        error: describeWriteError(error),
      });
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    const refusal = checkRequest(req);
    if (refusal) {
      sendJson(res, refusal.status, { error: refusal.error });
      return;
    }
    if (path === STATUS_ROUTE) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        sendJson(res, 405, { error: "Method not allowed." });
        return;
      }
      try {
        sendJson(res, 200, await readStatus(dir));
      } catch (error) {
        sendJson(res, 500, { error: describeWriteError(error) });
      }
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }
    await handleSave(req, res);
  }

  return (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== BACKUP_ROUTE && path !== STATUS_ROUTE) {
      next();
      return;
    }
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "Vintry couldn't save the backup file." });
    });
  };
}

/** Adds the backup routes to `vite preview` only (the launcher). */
export function autoBackupPlugin(): Plugin {
  return {
    name: "vintry-auto-backup",
    configurePreviewServer(server) {
      server.middlewares.use(createAutoBackupMiddleware({ dir: resolveBackupDir() }));
    },
  };
}
