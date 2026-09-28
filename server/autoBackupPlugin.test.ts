// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WineSchema } from "../src/domain/types";
import {
  autoBackupFileName,
  backupsToPrune,
  createAutoBackupMiddleware,
  describeWriteError,
  MAX_BACKUP_BYTES,
  RECENT_BACKUPS_KEPT,
  resolveBackupDir,
  saveBackup,
  selectBackupsToKeep,
} from "./autoBackupPlugin";

const GOOD_HEADERS: Record<string, string> = {
  host: "localhost:47821",
  origin: "http://localhost:47821",
  "x-vintry-backup": "1",
  "content-type": "application/json",
};

/** The good headers without some of them. */
function without(...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(GOOD_HEADERS).filter(([key]) => !names.includes(key)));
}

function backup(exportedAt = "2026-09-27T10:00:00.000Z", note = "first") {
  return {
    app: "vintry",
    schemaVersion: 1,
    exportedAt,
    data: {
      wines: [],
      lots: [],
      consumptions: [],
      tastingNotes: [],
      locations: [],
      wishlist: [],
      eventBatches: [],
      chatThreads: [],
      chatMessages: [],
      settings: [{ key: "note", value: note }],
    },
  };
}

/** A valid wine row for a backup. */
function wine(id: string, isSample = false) {
  const t = "2026-09-01T10:00:00.000Z";
  return WineSchema.parse({
    id,
    createdAt: t,
    updatedAt: t,
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    colour: "red",
    isSample,
  });
}

/** `backup()` holding these wines. */
function cellar(wines: ReturnType<typeof wine>[], note = "first") {
  const base = backup(undefined, note);
  return { ...base, data: { ...base.data, wines } };
}

/** The automatic backup file name for a local date and time (month 1-12). */
function fileAt(year: number, month: number, day: number, hour = 12, minute = 0, second = 0) {
  return autoBackupFileName(new Date(year, month - 1, day, hour, minute, second));
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

let dir: string;
let server: Server;
let port: number;
let clock: Date;

function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const post = (body: unknown, headers: Record<string, string> = GOOD_HEADERS) =>
  send("POST", "/__vintry/backup", headers, JSON.stringify(body));

async function backupFiles(): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.startsWith("vintry-backup-")).sort();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vintry-autobackup-"));
  clock = new Date(2026, 8, 27, 14, 30, 5);
  const middleware = createAutoBackupMiddleware({ dir, now: () => clock });
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end("{}");
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe("request checks", () => {
  it.each([
    ["a wrong Host (DNS rebinding)", { host: "evil.example:47821" }],
    ["a Host on another port", { host: "localhost:5173" }],
    ["another Origin", { origin: "http://localhost:5173" }],
    ["a look-alike Origin", { origin: "http://localhost:47821.evil.example" }],
    ["an Origin of null", { origin: "null" }],
    ["no marker header", { "x-vintry-backup": "" }],
  ])("refuses a POST with %s", async (_, override) => {
    const headers: Record<string, string> = { ...GOOD_HEADERS, ...override };
    for (const [key, value] of Object.entries(headers)) if (value === "") delete headers[key];
    const reply = await post(backup(), headers);
    expect(reply.status).toBe(403);
    expect(await backupFiles()).toEqual([]);
  });

  it("refuses a POST with no Origin", async () => {
    const headers = without("origin");
    expect((await post(backup(), headers)).status).toBe(403);
  });

  it("refuses a body that isn't JSON", async () => {
    const reply = await post(backup(), { ...GOOD_HEADERS, "content-type": "text/plain" });
    expect(reply.status).toBe(415);
  });

  it("refuses JSON that isn't a Vintry backup", async () => {
    const reply = await post({ hello: "world" });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toBe("This is not a Vintry backup.");
    expect((await post({ ...backup(), schemaVersion: 999 })).status).toBe(400);
    expect(await backupFiles()).toEqual([]);
  });

  it("refuses a body over the size limit", async () => {
    const reply = await send(
      "POST",
      "/__vintry/backup",
      { ...GOOD_HEADERS, "content-length": String(MAX_BACKUP_BYTES + 1) },
      "",
    ).catch(() => ({ status: 413, body: {} }));
    expect(reply.status).toBe(413);
  });

  it("answers status for a same-origin GET, which carries no Origin", async () => {
    const headers = without("origin", "content-type");
    const reply = await send("GET", "/__vintry/backup/status", {
      ...headers,
      "sec-fetch-site": "same-origin",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ folder: dir, latest: null, count: 0 });
  });

  it("refuses status from another site or host", async () => {
    const headers = without("origin");
    const crossSite = await send("GET", "/__vintry/backup/status", {
      ...headers,
      "sec-fetch-site": "cross-site",
    });
    expect(crossSite.status).toBe(403);
    const wrongOrigin = await send("GET", "/__vintry/backup/status", {
      ...GOOD_HEADERS,
      origin: "http://evil.example",
    });
    expect(wrongOrigin.status).toBe(403);
    const wrongHost = await send("GET", "/__vintry/backup/status", {
      ...headers,
      host: "vintry.evil.example",
    });
    expect(wrongHost.status).toBe(403);
  });

  it("accepts the 127.0.0.1 address too", async () => {
    const reply = await post(backup(), {
      ...GOOD_HEADERS,
      host: "127.0.0.1:47821",
      origin: "http://127.0.0.1:47821",
    });
    expect(reply.status).toBe(200);
  });

  it("passes other paths on", async () => {
    expect((await send("GET", "/__vintry/other", GOOD_HEADERS)).status).toBe(404);
  });
});

describe("saving", () => {
  it("writes a dated file chosen by the server and reports it in status", async () => {
    const reply = await post(backup());
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      written: true,
      folder: dir,
      count: 1,
      latest: { name: "vintry-backup-2026-09-27-143005.json" },
    });
    const saved = JSON.parse(
      await readFile(join(dir, "vintry-backup-2026-09-27-143005.json"), "utf8"),
    );
    expect(saved).toEqual(backup());
    // No temporary file is left behind.
    expect(await readdir(dir)).toEqual(["vintry-backup-2026-09-27-143005.json"]);

    const headers = without("origin", "content-type");
    const status = await send("GET", "/__vintry/backup/status", headers);
    expect(status.body).toMatchObject({
      count: 1,
      latest: { name: "vintry-backup-2026-09-27-143005.json" },
    });
  });

  it("ignores anything in the request that looks like a file name or path", async () => {
    const reply = await send(
      "POST",
      "/__vintry/backup?name=../../evil.json",
      GOOD_HEADERS,
      JSON.stringify({ ...backup(), name: "../evil.json", fileName: "/tmp/evil.json" }),
    );
    expect(reply.status).toBe(200);
    expect(await readdir(dir)).toEqual(["vintry-backup-2026-09-27-143005.json"]);
  });

  it("skips a backup identical to the newest one apart from its time", async () => {
    await post(backup("2026-09-27T10:00:00.000Z"));
    clock = new Date(2026, 8, 27, 15, 0, 0);
    const again = await post(backup("2026-09-27T11:00:00.000Z"));
    expect(again.body).toMatchObject({ written: false, skipped: "unchanged", count: 1 });
    expect(await backupFiles()).toHaveLength(1);

    const changed = await post(backup("2026-09-27T11:00:00.000Z", "second"));
    expect(changed.body).toMatchObject({ written: true, count: 2 });
    expect(await backupFiles()).toEqual([
      "vintry-backup-2026-09-27-143005.json",
      "vintry-backup-2026-09-27-150000.json",
    ]);
  });

  it("creates the folder when it is missing", async () => {
    const nested = join(dir, "not", "yet");
    await saveBackup(nested, backup(), clock);
    expect(await readdir(nested)).toEqual(["vintry-backup-2026-09-27-143005.json"]);
  });

  it("describes disk errors in plain words", () => {
    expect(describeWriteError(Object.assign(new Error(), { code: "ENOSPC" }))).toMatch(
      /disk is full/,
    );
    expect(describeWriteError(Object.assign(new Error(), { code: "EACCES" }))).toMatch(
      /not allowed/,
    );
  });
});

describe("retention tiers", () => {
  /** Local calendar dates, `count` days back from (and including) year-month-day. */
  function daysBack(year: number, month: number, day: number, count: number) {
    return Array.from({ length: count }, (_, i) => new Date(year, month - 1, day - i));
  }
  const at = (date: Date, hour: number) =>
    fileAt(date.getFullYear(), date.getMonth() + 1, date.getDate(), hour);

  it("keeps everything while there are only a few files", () => {
    const names = [fileAt(2020, 1, 1), fileAt(2026, 9, 26), fileAt(2026, 9, 27, 9)];
    expect([...selectBackupsToKeep(names, new Date(2026, 8, 27, 23))].sort()).toEqual(names);
  });

  it("keeps the newest 20, the last of each of 14 days, 8 ISO weeks and 12 months", () => {
    // Two files a day, at 09:00 and 21:00, for 400 days up to Sunday 27 September 2026.
    const names = daysBack(2026, 9, 27, 400).flatMap((date) => [at(date, 9), at(date, 21)]);
    const kept = selectBackupsToKeep(names, new Date(2026, 8, 27, 23, 0, 0));

    const recent = daysBack(2026, 9, 27, 10).flatMap((date) => [at(date, 9), at(date, 21)]);
    const daily = daysBack(2026, 9, 27, 14).map((date) => at(date, 21));
    // ISO weeks 32 to 39 end on these Sundays.
    const weekly = [
      [8, 9],
      [8, 16],
      [8, 23],
      [8, 30],
      [9, 6],
      [9, 13],
      [9, 20],
      [9, 27],
    ].map(([month, day]) => fileAt(2026, month!, day!, 21));
    const monthly = [
      fileAt(2025, 10, 31, 21),
      fileAt(2025, 11, 30, 21),
      fileAt(2025, 12, 31, 21),
      ...[
        [1, 31],
        [2, 28],
        [3, 31],
        [4, 30],
        [5, 31],
        [6, 30],
        [7, 31],
        [8, 31],
        [9, 27],
      ].map(([month, day]) => fileAt(2026, month!, day!, 21)),
    ];
    expect(recent).toHaveLength(RECENT_BACKUPS_KEPT);
    const expected = new Set([...recent, ...daily, ...weekly, ...monthly]);
    expect([...kept].sort()).toEqual([...expected].sort());
    expect(kept.size).toBe(41);
    // Nothing from September 2025 or earlier, and the morning files of older days go.
    expect(kept.has(fileAt(2025, 9, 30, 21))).toBe(false);
    expect(kept.has(fileAt(2026, 9, 14, 9))).toBe(false);
  });

  it("groups by ISO week across the new year", () => {
    // Monday 28 December 2026 to Sunday 3 January 2027 is ISO week 2026-W53.
    const names = [
      fileAt(2026, 12, 28, 10),
      fileAt(2026, 12, 30, 10),
      fileAt(2027, 1, 2, 23, 59, 59),
      // 20 newer files on one day, which fill the recent tier.
      ...Array.from({ length: 20 }, (_, i) => fileAt(2027, 2, 10, 9, i)),
    ];
    const kept = selectBackupsToKeep(names, new Date(2027, 1, 10, 12));
    expect(kept.has(fileAt(2027, 1, 2, 23, 59, 59))).toBe(true); // 2026-W53, and January
    expect(kept.has(fileAt(2026, 12, 30, 10))).toBe(true); // December
    expect(kept.has(fileAt(2026, 12, 28, 10))).toBe(false);
    expect(kept.size).toBe(22);
  });

  it("goes by the date in the file name, and keeps files dated after now", () => {
    const names = [
      ...Array.from({ length: 25 }, (_, i) => fileAt(2026, 9, 27, 8, i)),
      fileAt(2026, 10, 5), // the clock was set back since this one
    ];
    const kept = selectBackupsToKeep(names, new Date(2026, 8, 27, 14));
    expect(kept.has(fileAt(2026, 10, 5))).toBe(true);
    expect(kept.has(fileAt(2026, 9, 27, 8, 24))).toBe(true);
    expect(kept.has(fileAt(2026, 9, 27, 8, 4))).toBe(false);
  });

  it("never offers to delete a file that isn't an automatic backup", () => {
    const others = [
      "vintry-backup-2020-01-01.json",
      "vintry-backup-2020-01-01-000000.json.bak",
      "vintry-backup-2020-01-01-000000 (1).json",
      "Vintry-backup-2020-01-01-000000.json",
      "notes.txt",
      ".vintry-backup-0123456789abcdef.tmp",
    ];
    const flood = Array.from({ length: 30 }, (_, i) => fileAt(2026, 9, 27, 10, i));
    const names = [...others, fileAt(2020, 1, 1), ...flood];
    const pruned = backupsToPrune(names, new Date(2026, 8, 27, 12));
    expect(pruned).toEqual([fileAt(2020, 1, 1), ...flood.slice(0, 10)]);
    expect(selectBackupsToKeep(others, new Date(2026, 8, 27)).size).toBe(0);
  });

  it("keeps older days' backups when a second browser writes 100 files in an hour", async () => {
    const others = [
      "vintry-backup-2020-01-01.json",
      "notes.txt",
      "vintry-backup-2020-01-01-000000.json.bak",
    ];
    for (const name of others) await writeFile(join(dir, name), "mine");
    // The collector's own browser: one backup each evening for the 60 days before today.
    const good = daysBack(2026, 9, 26, 60).map((date) => at(date, 20));
    for (const [i, name] of good.entries()) {
      await writeFile(join(dir, name), JSON.stringify(cellar([wine("w1")], `day ${i}`)));
    }
    // Another browser, with its own wines, saves every 30 seconds on Sunday 27 September.
    for (let i = 0; i < 100; i += 1) {
      const when = new Date(2026, 8, 27, 12, 0, i * 30);
      const reply = await saveBackup(dir, cellar([wine("other")], `browser B ${i}`), when);
      expect(reply.written).toBe(true);
    }

    const files = await readdir(dir);
    for (const name of others) expect(files).toContain(name);
    const kept = (await backupFiles()).filter((name) => /-\d{6}\.json$/.test(name));
    const today = kept.filter((name) => name.startsWith("vintry-backup-2026-09-27-"));
    expect(today).toHaveLength(RECENT_BACKUPS_KEPT);
    expect(today.at(-1)).toBe(fileAt(2026, 9, 27, 12, 49, 30));
    // Every day of the last two weeks, each Sunday of the last 8 ISO weeks, and the last
    // backup of July and of August are still there.
    const expected = [
      ...daysBack(2026, 9, 26, 13).map((date) => at(date, 20)),
      ...[
        [8, 9],
        [8, 16],
        [8, 23],
        [8, 30],
        [9, 6],
        [9, 13],
      ].map(([month, day]) => fileAt(2026, month!, day!, 20)),
      fileAt(2026, 7, 31, 20),
      fileAt(2026, 8, 31, 20),
    ];
    expect(kept.filter((name) => !today.includes(name)).sort()).toEqual(expected.sort());
  });
});

describe("empty cellars", () => {
  it("doesn't save a backup without wines over one with wines", async () => {
    const first = await saveBackup(dir, cellar([wine("w1")]), new Date(2026, 8, 27, 10));
    expect(first).toEqual({ written: true });
    for (let i = 0; i < 100; i += 1) {
      // A test profile, empty or with only the sample wines, saving again and again.
      const empty =
        i % 2 ? backup(undefined, `empty ${i}`) : cellar([wine("s1", true)], `sample ${i}`);
      expect(await saveBackup(dir, empty, new Date(2026, 8, 27, 11, i))).toEqual({
        written: false,
        skipped: "empty",
      });
    }
    expect(await backupFiles()).toEqual([fileAt(2026, 9, 27, 10)]);

    // Real wines again are saved as usual.
    const next = await saveBackup(dir, cellar([wine("w2")]), new Date(2026, 8, 27, 13));
    expect(next).toEqual({ written: true });
    expect(await backupFiles()).toEqual([fileAt(2026, 9, 27, 10), fileAt(2026, 9, 27, 13)]);
  });

  it("saves an empty cellar into an empty folder, or after another empty backup", async () => {
    const first = await saveBackup(dir, backup(undefined, "a"), new Date(2026, 8, 27, 10));
    expect(first).toEqual({ written: true });
    const second = await saveBackup(dir, backup(undefined, "b"), new Date(2026, 8, 27, 11));
    expect(second).toEqual({ written: true });
    expect(await backupFiles()).toHaveLength(2);
  });

  it("counts wines in the bin as wines", async () => {
    await saveBackup(dir, cellar([wine("w1")]), new Date(2026, 8, 27, 10));
    const binned = { ...wine("w1"), deletedAt: "2026-09-27T10:30:00.000Z" };
    const reply = await saveBackup(dir, cellar([binned]), new Date(2026, 8, 27, 11));
    expect(reply).toEqual({ written: true });
  });

  it("tells the app when it skipped an empty backup", async () => {
    await post(cellar([wine("w1")]));
    clock = new Date(2026, 8, 27, 15, 0, 0);
    const reply = await post(backup(undefined, "empty"));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      written: false,
      skipped: "empty",
      count: 1,
      latest: { name: "vintry-backup-2026-09-27-143005.json" },
    });
  });
});

describe("resolveBackupDir", () => {
  const home = "/home/ann";
  const only =
    (...dirs: string[]) =>
    (path: string) =>
      dirs.includes(path);

  it("uses VINTRY_BACKUP_DIR when set", () => {
    expect(resolveBackupDir({ VINTRY_BACKUP_DIR: "/data/backups" }, "linux", home, only())).toBe(
      "/data/backups",
    );
  });

  it("uses Documents in the home folder", () => {
    expect(resolveBackupDir({}, "darwin", home, only(join(home, "Documents")))).toBe(
      join(home, "Documents", "Vintry Backups"),
    );
  });

  it("falls back to the home folder without Documents", () => {
    expect(resolveBackupDir({}, "linux", home, only())).toBe(join(home, "Vintry Backups"));
  });

  it("prefers OneDrive's Documents on Windows", () => {
    const oneDrive = "/onedrive";
    expect(
      resolveBackupDir(
        { OneDrive: oneDrive },
        "win32",
        home,
        only(join(oneDrive, "Documents"), join(home, "Documents")),
      ),
    ).toBe(join(oneDrive, "Documents", "Vintry Backups"));
    expect(
      resolveBackupDir({ OneDrive: oneDrive }, "win32", home, only(join(home, "Documents"))),
    ).toBe(join(home, "Documents", "Vintry Backups"));
    // Other systems ignore OneDrive.
    expect(
      resolveBackupDir(
        { OneDrive: oneDrive },
        "darwin",
        home,
        only(join(oneDrive, "Documents"), join(home, "Documents")),
      ),
    ).toBe(join(home, "Documents", "Vintry Backups"));
  });
});

describe("autoBackupFileName", () => {
  it("uses local date and time", () => {
    expect(autoBackupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "vintry-backup-2026-01-02-030405.json",
    );
  });
});
