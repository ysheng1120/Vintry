// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_BACKUPS_KEPT,
  autoBackupFileName,
  createAutoBackupMiddleware,
  describeWriteError,
  MAX_BACKUP_BYTES,
  resolveBackupDir,
  saveBackup,
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
    expect(again.body).toMatchObject({ written: false, count: 1 });
    expect(await backupFiles()).toHaveLength(1);

    const changed = await post(backup("2026-09-27T11:00:00.000Z", "second"));
    expect(changed.body).toMatchObject({ written: true, count: 2 });
    expect(await backupFiles()).toEqual([
      "vintry-backup-2026-09-27-143005.json",
      "vintry-backup-2026-09-27-150000.json",
    ]);
  });

  it("keeps the newest 30 backups and never deletes other files", async () => {
    await writeFile(join(dir, "vintry-backup-2020-01-01.json"), "manual download");
    await writeFile(join(dir, "notes.txt"), "mine");
    await writeFile(join(dir, "vintry-backup-2020-01-01-000000.json.bak"), "mine");
    for (let i = 0; i < AUTO_BACKUPS_KEPT + 3; i += 1) {
      await saveBackup(dir, backup(undefined, `change ${i}`), new Date(2026, 8, 1, 0, 0, i));
    }
    const kept = (await backupFiles()).filter((name) => /-\d{6}\.json$/.test(name));
    expect(kept).toHaveLength(AUTO_BACKUPS_KEPT);
    expect(kept[0]).toBe("vintry-backup-2026-09-01-000003.json");
    expect(kept.at(-1)).toBe("vintry-backup-2026-09-01-000032.json");
    const all = await readdir(dir);
    expect(all).toContain("vintry-backup-2020-01-01.json");
    expect(all).toContain("notes.txt");
    expect(all).toContain("vintry-backup-2020-01-01-000000.json.bak");
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
