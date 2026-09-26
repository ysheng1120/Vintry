import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../../db/testing";
import { addBottles } from "../../domain/commands";
import { setClock } from "../../domain/clock";
import {
  BACKUP_REMINDER_CHANGE_THRESHOLD,
  BACKUP_REMINDER_DAYS,
  shouldShowBackupReminder,
  snoozeUntil,
  trackFirstChangeSinceBackup,
  type BackupReminderState,
} from "./reminder";

const NOW = new Date("2026-09-26T12:00:00Z");

function state(overrides: Partial<BackupReminderState> = {}): BackupReminderState {
  return {
    changesSinceBackup: 0,
    lastBackupAt: null,
    firstChangeSinceBackup: null,
    snoozedUntil: null,
    ...overrides,
  };
}

describe("shouldShowBackupReminder", () => {
  it("does not show with no changes", () => {
    expect(shouldShowBackupReminder(state(), NOW)).toBe(false);
  });

  it("shows once 20 changes pile up", () => {
    expect(
      shouldShowBackupReminder(
        state({ changesSinceBackup: BACKUP_REMINDER_CHANGE_THRESHOLD }),
        NOW,
      ),
    ).toBe(true);
    expect(
      shouldShowBackupReminder(
        state({ changesSinceBackup: BACKUP_REMINDER_CHANGE_THRESHOLD - 1 }),
        NOW,
      ),
    ).toBe(false);
  });

  it("shows after 14+ days since the last backup, with at least one change", () => {
    const fourteenDaysAgo = new Date(NOW.getTime() - BACKUP_REMINDER_DAYS * 86_400_000);
    expect(
      shouldShowBackupReminder(
        state({ changesSinceBackup: 1, lastBackupAt: fourteenDaysAgo.toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it("does not show before 14 days have passed", () => {
    const recently = new Date(NOW.getTime() - 3 * 86_400_000);
    expect(
      shouldShowBackupReminder(
        state({ changesSinceBackup: 1, lastBackupAt: recently.toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it("falls back to the first change when never backed up", () => {
    const fifteenDaysAgo = new Date(NOW.getTime() - 15 * 86_400_000);
    expect(
      shouldShowBackupReminder(
        state({ changesSinceBackup: 1, firstChangeSinceBackup: fifteenDaysAgo.toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it("stays hidden while snoozed, even past the day threshold", () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 86_400_000);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect(
      shouldShowBackupReminder(
        state({
          changesSinceBackup: 1,
          lastBackupAt: thirtyDaysAgo.toISOString(),
          snoozedUntil: tomorrow.toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("shows again once the snooze has passed", () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 86_400_000);
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    expect(
      shouldShowBackupReminder(
        state({
          changesSinceBackup: 1,
          lastBackupAt: thirtyDaysAgo.toISOString(),
          snoozedUntil: yesterday.toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("snoozeUntil", () => {
  it("adds the given number of days", () => {
    expect(snoozeUntil(NOW, 3)).toBe(new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
  });
});

describe("trackFirstChangeSinceBackup", () => {
  beforeEach(resetDatabase);

  it("records the time of the first committed change", async () => {
    setClock(NOW);
    const unsubscribe = trackFirstChangeSinceBackup();
    try {
      await addBottles({
        drafts: [
          {
            producer: "Ridge",
            vintage: 2019,
            colour: "red",
            lots: [{ quantity: 1 }],
          },
        ],
      });
      // The listener's write is fire-and-forget; let its microtask settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { getSetting } = await import("../../db/settings");
      const recorded = await getSetting<string | null>("firstChangeSinceBackup", null);
      expect(recorded).not.toBeNull();
      expect(new Date(recorded!).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    } finally {
      unsubscribe();
    }
  });
});
