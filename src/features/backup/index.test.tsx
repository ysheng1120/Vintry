import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { getSetting, SETTING_KEYS } from "../../db/settings";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { AUTO_BACKUP_STATUS_URL, resetAutoBackupForTests } from "./autoBackup";
import BackupPage from "./index";

function renderPage() {
  render(
    <ToastProvider>
      <BackupPage />
    </ToastProvider>,
  );
}

/** jsdom has no real Blob download machinery; stand in for it. */
function stubObjectUrls() {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
}

async function seedOneWine() {
  const location = makeLocation({ name: "Kitchen rack" });
  await db.locations.add(location);
  const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
  await db.wines.add(wine);
  await db.lots.add(makeLot({ wineId: wine.id, locationId: location.id, quantity: 6 }));
  return wine;
}

function backupFile(name: string, text: string): File {
  return new File([text], name, { type: "application/json" });
}

describe("BackupPage", () => {
  beforeEach(() => {
    stubObjectUrls();
    resetAutoBackupForTests();
    return resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows 'never' with no prior backup", async () => {
    renderPage();
    expect(await screen.findByText("never")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("exports a backup, downloads it, and marks the backup done", async () => {
    await seedOneWine();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Export backup" }));

    expect(await screen.findByText("Backup exported")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalled();
    await waitFor(async () => {
      expect(await getSetting<number>(SETTING_KEYS.changesSinceBackup, -1)).toBe(0);
    });
    expect(await getSetting<string | null>(SETTING_KEYS.lastBackupAt, null)).not.toBeNull();
  });

  it("exports a CSV of the cellar", async () => {
    await seedOneWine();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText("CSV exported")).toBeInTheDocument();
  });

  it("shows a plain-language error for a file that isn't a Vintry backup", async () => {
    renderPage();
    const input = screen.getByLabelText(/Vintry backup file/i);
    await userEvent.upload(input, backupFile("not-a-backup.json", '{"hello":"world"}'));
    expect(await screen.findByRole("alert")).toHaveTextContent("This is not a Vintry backup.");
  });

  it("restores a backup after typing REPLACE, taking a safety snapshot first", async () => {
    const wine = await seedOneWine();
    const backup = await (await import("../../db/backup")).exportBackup();
    await resetDatabase();

    renderPage();
    const input = screen.getByLabelText(/Vintry backup file/i);
    await userEvent.upload(input, backupFile("backup.json", JSON.stringify(backup)));

    await screen.findByText("Replace all data with this backup?");
    const wordField = screen.getByLabelText('Type "REPLACE" to confirm');
    const confirmButton = screen.getByRole("button", { name: "Replace data" });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(wordField, "REPLACE");
    expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(async () => expect(await db.wines.count()).toBe(1));
    const restored = await db.wines.toArray();
    expect(restored[0]).toMatchObject({ id: wine.id, producer: "Ridge" });
    expect(await db.snapshots.count()).toBe(1);
    expect(await screen.findByText(/Restored a backup/)).toBeInTheDocument();
  });

  it("deletes all data after typing DELETE, and lists the safety snapshot taken first", async () => {
    await seedOneWine();
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    await screen.findByText("Delete all data on this device?");
    const wordField = screen.getByLabelText('Type "DELETE" to confirm');
    const confirmButton = screen.getByRole("button", { name: "Delete everything" });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(wordField, "DELETE");
    await userEvent.click(confirmButton);

    await waitFor(async () => expect(await db.wines.count()).toBe(0));
    expect(await screen.findByText(/Before erasing all data/)).toBeInTheDocument();
  });

  it("restores a safety snapshot from the list", async () => {
    await seedOneWine();
    renderPage();

    // Deleting takes a snapshot of the one wine, then removes it.
    await userEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    await screen.findByText("Delete all data on this device?");
    await userEvent.type(screen.getByLabelText('Type "DELETE" to confirm'), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await waitFor(async () => expect(await db.wines.count()).toBe(0));

    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText("Bring back this saved copy?");
    await userEvent.click(screen.getByRole("button", { name: "Bring back this copy" }));

    await waitFor(async () => expect(await db.wines.count()).toBe(1));
  });

  it("says automatic backups need the launcher when it isn't there, and keeps manual export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    renderPage();
    expect(
      await screen.findByText(/Automatic backups work when you start Vintry with the launcher/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export backup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose backup file" })).toBeInTheDocument();
  });

  it("shows where automatic backups go and when the last one was saved", async () => {
    const savedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            folder: "/Users/ann/Documents/Vintry Backups",
            latest: { name: "vintry-backup-2026-09-27-143005.json", savedAt },
            count: 4,
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const card = (await screen.findByRole("heading", { name: "Automatic backups" })).closest(
      "div",
    )!;
    expect(card).toHaveTextContent(
      "On. Vintry saves a backup to /Users/ann/Documents/Vintry Backups after your changes. Last saved 5 minutes ago. The 30 newest are kept.",
    );
    expect(card).toHaveTextContent("To restore, choose a file from that folder");
    expect(fetchMock).toHaveBeenCalledWith(AUTO_BACKUP_STATUS_URL, expect.anything());
  });
});
