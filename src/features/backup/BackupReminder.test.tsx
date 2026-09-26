import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { BannerProvider, BannerSlot } from "../../app/Banners";
import { resetDatabase } from "../../db/testing";
import { getSetting, SETTING_KEYS, setSetting } from "../../db/settings";
import BackupReminder from "./BackupReminder";
import { BACKUP_SNOOZE_UNTIL_KEY } from "./reminder";

function renderApp() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <BannerProvider>
            <BannerSlot />
            <BackupReminder />
            <h1>Home</h1>
          </BannerProvider>
        ),
      },
      { path: "/backup", element: <h1>Backup &amp; restore</h1> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

describe("BackupReminder", () => {
  beforeEach(resetDatabase);

  it("shows no banner with no changes since the last backup", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Home" });
    expect(screen.queryByText("Time for a backup")).not.toBeInTheDocument();
  });

  it("shows the banner once 20 changes pile up", async () => {
    await setSetting(SETTING_KEYS.changesSinceBackup, 20);
    renderApp();
    expect(await screen.findByText("Time for a backup")).toBeInTheDocument();
    expect(screen.getByText("You made 20 changes since your last backup.")).toBeInTheDocument();
  });

  it("shows the banner after 14+ days since the last backup", async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86_400_000).toISOString();
    await setSetting(SETTING_KEYS.changesSinceBackup, 1);
    await setSetting(SETTING_KEYS.lastBackupAt, fifteenDaysAgo);
    renderApp();
    expect(await screen.findByText("Time for a backup")).toBeInTheDocument();
  });

  it("does not show before 20 changes or 14 days", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await setSetting(SETTING_KEYS.changesSinceBackup, 3);
    await setSetting(SETTING_KEYS.lastBackupAt, twoDaysAgo);
    renderApp();
    await screen.findByRole("heading", { name: "Home" });
    expect(screen.queryByText("Time for a backup")).not.toBeInTheDocument();
  });

  it("navigates to /backup when 'Back up now' is clicked", async () => {
    await setSetting(SETTING_KEYS.changesSinceBackup, 20);
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(await screen.findByRole("heading", { name: "Backup & restore" })).toBeInTheDocument();
  });

  it("snoozes for 3 days and hides the banner when 'Later' is clicked", async () => {
    await setSetting(SETTING_KEYS.changesSinceBackup, 20);
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText("Time for a backup")).not.toBeInTheDocument();
    await waitFor(async () => {
      const snoozedUntil = await getSetting<string | null>(BACKUP_SNOOZE_UNTIL_KEY, null);
      expect(snoozedUntil).not.toBeNull();
    });
    const snoozedUntil = await getSetting<string | null>(BACKUP_SNOOZE_UNTIL_KEY, null);
    const days = (new Date(snoozedUntil!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });

  it("records a first-change timestamp so the 14-day clock can start without a backup", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Home" });
    const { addBottles } = await import("../../domain/commands");
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    await waitFor(async () => {
      const recorded = await getSetting<string | null>("firstChangeSinceBackup", null);
      expect(recorded).not.toBeNull();
    });
  });
});
