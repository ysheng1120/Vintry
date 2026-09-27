import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerProvider, BannerSlot } from "../../app/Banners";
import { parseBackup } from "../../db/backup";
import { getSetting, SETTING_KEYS, setSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { createLocation } from "../../domain/commands";
import AutoBackupWatcher from "./AutoBackupWatcher";
import {
  AUTO_BACKUP_STATUS_URL,
  AUTO_BACKUP_URL,
  checkAutoBackup,
  createAutoBackupScheduler,
  formatSavedAgo,
  getAutoBackupState,
  isNewChange,
  LAUNCHER_STOPPED_MESSAGE,
  needsBackupAtStart,
  prepareBackup,
  resetAutoBackupForTests,
  runAutoBackup,
  type AutoBackupStatus,
} from "./autoBackup";

const FOLDER = "/Users/ann/Documents/Vintry Backups";
const SAVED = { name: "vintry-backup-2026-09-27-143005.json", savedAt: "2026-09-27T12:30:05.000Z" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Launcher {
  fetch: ReturnType<typeof vi.fn>;
  posts: () => { body: string; init: RequestInit }[];
}

/** Stands in for the launcher's server. */
function mockLauncher({
  latest = null,
  save = () => json(200, { written: true, folder: FOLDER, latest: SAVED, count: 1 }),
}: {
  latest?: AutoBackupStatus["latest"];
  save?: () => Response | Promise<Response>;
} = {}): Launcher {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === AUTO_BACKUP_STATUS_URL) return json(200, { folder: FOLDER, latest, count: 0 });
    if (url === AUTO_BACKUP_URL && init.method === "POST") return save();
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetch: fetchMock,
    posts: () =>
      fetchMock.mock.calls
        .filter(([url]) => url === AUTO_BACKUP_URL)
        .map(([, init]) => ({ body: String(init?.body), init: init ?? {} })),
  };
}

function renderShell() {
  render(
    <BannerProvider>
      <BannerSlot />
      <AutoBackupWatcher />
    </BannerProvider>,
  );
}

beforeEach(async () => {
  resetAutoBackupForTests();
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("availability", () => {
  it.each([
    ["the request fails", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["the server has no such route", async () => new Response("", { status: 404 })],
    [
      "the server answers with the app's page",
      async () =>
        new Response("<!doctype html><title>Vintry</title>", {
          headers: { "content-type": "text/html" },
        }),
    ],
    ["the answer is not a status", async () => json(200, { hello: "world" })],
  ])("stays silent and changes nothing when %s", async (_, answer) => {
    const fetchMock = vi.fn(answer);
    vi.stubGlobal("fetch", fetchMock);
    await setSetting(SETTING_KEYS.changesSinceBackup, 5);
    renderShell();

    await waitFor(() => expect(getAutoBackupState().kind).toBe("unavailable"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(AUTO_BACKUP_STATUS_URL, expect.anything());
    expect(await getSetting(SETTING_KEYS.changesSinceBackup, 0)).toBe(5);
    expect(screen.queryByRole("region", { name: "Notices" })).not.toBeInTheDocument();
  });

  it("checks only once per page load", async () => {
    const launcher = mockLauncher();
    await checkAutoBackup();
    await checkAutoBackup();
    expect(launcher.fetch).toHaveBeenCalledTimes(1);
    expect(getAutoBackupState()).toMatchObject({ kind: "on", status: { folder: FOLDER } });
  });
});

describe("runAutoBackup", () => {
  it("sends a valid backup with the launcher's headers and marks the backup done", async () => {
    const launcher = mockLauncher();
    await createLocation({ name: "Kitchen rack" });
    expect(await getSetting(SETTING_KEYS.changesSinceBackup, 0)).toBe(1);
    await checkAutoBackup();

    expect(await runAutoBackup()).toBe(true);

    const [post] = launcher.posts();
    expect(post?.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Vintry-Backup": "1",
    });
    expect(parseBackup(post?.body).ok).toBe(true);
    expect(await getSetting(SETTING_KEYS.changesSinceBackup, -1)).toBe(0);
    expect(await getSetting(SETTING_KEYS.lastBackupAt, null)).not.toBeNull();
    expect(getAutoBackupState()).toMatchObject({ kind: "on", status: { latest: SAVED } });
  });

  it("does not mark the backup done when a change landed while it was being sent", async () => {
    mockLauncher({
      save: async () => {
        await createLocation({ name: "Garage" });
        return json(200, { written: true, folder: FOLDER, latest: SAVED, count: 1 });
      },
    });
    await createLocation({ name: "Kitchen rack" });
    await checkAutoBackup();

    expect(await runAutoBackup()).toBe(true);
    expect(await getSetting(SETTING_KEYS.changesSinceBackup, 0)).toBe(2);
    expect(await getSetting(SETTING_KEYS.lastBackupAt, null)).toBeNull();
  });

  it("keeps the server's plain-words error and leaves the reminder counter alone", async () => {
    mockLauncher({
      save: () =>
        json(507, { error: "The disk is full. Free up some space so Vintry can save backups." }),
    });
    await createLocation({ name: "Kitchen rack" });
    await checkAutoBackup();

    expect(await runAutoBackup()).toBe(false);
    expect(getAutoBackupState()).toMatchObject({ error: expect.stringMatching(/disk is full/) });
    expect(await getSetting(SETTING_KEYS.changesSinceBackup, 0)).toBe(1);
  });

  it("sends a prepared backup at once, before any wait, for a closing page", async () => {
    const launcher = mockLauncher();
    await createLocation({ name: "Kitchen rack" });
    await checkAutoBackup();
    const prepared = await prepareBackup();

    const saving = runAutoBackup({ keepalive: true, prepared });
    expect(launcher.posts()).toHaveLength(1);
    expect(launcher.posts()[0]?.init.keepalive).toBe(true);
    expect(await saving).toBe(true);
  });

  it("says the launcher is closed when the request cannot reach it", async () => {
    mockLauncher({ save: () => Promise.reject(new TypeError("Failed to fetch")) });
    await checkAutoBackup();
    expect(await runAutoBackup()).toBe(false);
    expect(getAutoBackupState()).toMatchObject({ error: LAUNCHER_STOPPED_MESSAGE });
  });
});

describe("the runner in the app shell", () => {
  it("backs up once at start when changes are waiting", async () => {
    const launcher = mockLauncher();
    await createLocation({ name: "Kitchen rack" });
    renderShell();

    await waitFor(() => expect(launcher.posts()).toHaveLength(1));
    await waitFor(async () =>
      expect(await getSetting(SETTING_KEYS.changesSinceBackup, -1)).toBe(0),
    );
    // Marking the backup done is not itself a change: no second backup follows.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launcher.posts()).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Notices" })).not.toBeInTheDocument();
  });

  it("does not back up at start when the newest file is up to date", async () => {
    await createLocation({ name: "Kitchen rack" });
    await setSetting(SETTING_KEYS.changesSinceBackup, 0);
    const launcher = mockLauncher({
      latest: { name: SAVED.name, savedAt: new Date(Date.now() + 1000).toISOString() },
    });
    renderShell();
    await waitFor(() => expect(getAutoBackupState().kind).toBe("on"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launcher.posts()).toHaveLength(0);
  });

  it("waits after a change, and sends it with keepalive when the page is hidden", async () => {
    const launcher = mockLauncher({ latest: SAVED });
    renderShell();
    await waitFor(() => expect(getAutoBackupState().kind).toBe("on"));

    await act(() => createLocation({ name: "Kitchen rack" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launcher.posts()).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(launcher.posts()).toHaveLength(1));
    expect(launcher.posts()[0]?.init.keepalive).toBe(true);
  });

  it("shows one quiet banner when backups start failing", async () => {
    mockLauncher({
      save: () =>
        json(507, { error: "The disk is full. Free up some space so Vintry can save backups." }),
    });
    await createLocation({ name: "Kitchen rack" });
    renderShell();

    expect(await screen.findByText("Automatic backups aren't working")).toBeInTheDocument();
    expect(screen.getByText(/The disk is full/)).toBeInTheDocument();
  });
});

describe("createAutoBackupScheduler", () => {
  it("runs once, a delay after the last of several changes", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => true);
    const scheduler = createAutoBackupScheduler(run, { delayMs: 60_000, retryMs: 300_000 });

    scheduler.changed();
    await vi.advanceTimersByTimeAsync(40_000);
    scheduler.changed();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("flushes a waiting change at once, and does nothing when none waits", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => true);
    const scheduler = createAutoBackupScheduler(run, { delayMs: 60_000 });

    scheduler.flushPending({ keepalive: true });
    expect(run).not.toHaveBeenCalled();
    scheduler.changed();
    scheduler.flushPending({ keepalive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledWith({ keepalive: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("retries after a failure", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => false);
    const scheduler = createAutoBackupScheduler(run, { delayMs: 1_000, retryMs: 10_000 });
    await scheduler.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("runs again after the current backup when a change arrives meanwhile", async () => {
    vi.useFakeTimers();
    let finish: (ok: boolean) => void = () => {};
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const scheduler = createAutoBackupScheduler(run, { delayMs: 1_000 });
    const first = scheduler.runNow();
    void scheduler.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    finish(true);
    await first;
    scheduler.dispose();
  });
});

describe("change detection", () => {
  const base = { changes: 2, newestBatch: "b1:", newestBatchAt: "2026-09-27T10:00:00.000Z" };

  it("sees a new change but not a finished backup", () => {
    expect(isNewChange(base, { ...base, changes: 3 })).toBe(true);
    expect(isNewChange(base, { ...base, newestBatch: "b2:" })).toBe(true);
    expect(isNewChange(base, { ...base, changes: 0 })).toBe(false);
  });

  it("backs up at start only when something is newer than the newest file", () => {
    const status = { folder: FOLDER, latest: SAVED, count: 1 };
    expect(needsBackupAtStart({ ...base, changes: 1 }, status)).toBe(true);
    expect(needsBackupAtStart({ ...base, changes: 0 }, status)).toBe(false);
    expect(
      needsBackupAtStart(
        { ...base, changes: 0, newestBatchAt: "2026-09-28T00:00:00.000Z" },
        status,
      ),
    ).toBe(true);
    expect(needsBackupAtStart({ ...base, changes: 0 }, { ...status, latest: null })).toBe(true);
    expect(
      needsBackupAtStart(
        { changes: 0, newestBatch: null, newestBatchAt: null },
        { ...status, latest: null },
      ),
    ).toBe(false);
  });
});

describe("formatSavedAgo", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  it.each([
    ["2026-09-27T11:59:30.000Z", "just now"],
    ["2026-09-27T11:55:00.000Z", "5 minutes ago"],
    ["2026-09-27T11:00:00.000Z", "1 hour ago"],
    ["2026-09-26T11:00:00.000Z", "yesterday"],
    ["2026-09-24T11:00:00.000Z", "3 days ago"],
  ])("%s reads as %s", (iso, text) => {
    expect(formatSavedAgo(iso, now)).toBe(text);
  });
});
