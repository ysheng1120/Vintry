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

/** How many automatic backup files stay in the folder. */
export const AUTO_BACKUPS_KEPT = 30;
/** Largest backup body accepted. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const FOLDER_NAME = "Vintry Backups";
/** Only files with exactly this name are ever counted, compared, or deleted. */
const BACKUP_NAME_PATTERN = /^vintry-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/;

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

/** The server's own file name for a backup, in local time: vintry-backup-2026-09-27-143005.json. */
export function autoBackupFileName(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
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

async function sameAsSaved(path: string, backup: Record<string, unknown>): Promise<boolean> {
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return false;
    return withoutTimestamp(saved as Record<string, unknown>) === withoutTimestamp(backup);
  } catch {
    return false;
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

/** Deletes automatic backup files past the newest 30. Never touches any other file. */
async function pruneBackups(dir: string): Promise<void> {
  const names = await listBackupNames(dir);
  for (const name of names.slice(0, Math.max(0, names.length - AUTO_BACKUPS_KEPT))) {
    await unlink(join(dir, name)).catch(() => {});
  }
}

/**
 * Saves `backup` unless it matches the newest saved file apart from its exported-at time.
 * The file name comes from the clock only, never from the request.
 */
export async function saveBackup(
  dir: string,
  backup: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ written: boolean }> {
  await mkdir(dir, { recursive: true });
  const newest = (await listBackupNames(dir)).at(-1);
  if (newest && (await sameAsSaved(join(dir, newest), backup))) return { written: false };
  await writeAtomically(dir, autoBackupFileName(now), JSON.stringify(backup, null, 2));
  try {
    await pruneBackups(dir);
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
  // One save at a time, so "same as the newest file" and pruning never race each other.
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
      const { written } = await serially(() => saveBackup(dir, backup, now()));
      sendJson(res, 200, { written, ...(await readStatus(dir)) });
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
