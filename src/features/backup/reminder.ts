import { getSetting, setSetting } from "../../db/settings";
import { onCommandCommitted } from "../../domain/commands";
import { nowIso } from "../../domain/clock";

/** When the first change since the last backup happened (cleared once a backup completes). */
export const FIRST_CHANGE_SINCE_BACKUP_KEY = "firstChangeSinceBackup";
/** Set by "Later" on the reminder banner; the reminder stays hidden until this time passes. */
export const BACKUP_SNOOZE_UNTIL_KEY = "backupReminderSnoozedUntil";

/** Show the reminder once 20 changes pile up (R22). */
export const BACKUP_REMINDER_CHANGE_THRESHOLD = 20;
/** Or once this many days pass since the last backup (or the first change, if never backed up). */
export const BACKUP_REMINDER_DAYS = 14;
/** How long "Later" snoozes the reminder for. */
export const BACKUP_SNOOZE_DAYS = 3;

const DAY_MS = 86_400_000;

export interface BackupReminderState {
  changesSinceBackup: number;
  lastBackupAt: string | null;
  firstChangeSinceBackup: string | null;
  snoozedUntil: string | null;
}

/**
 * Whether to show the "time for a backup" banner (R22): 20+ changes, or at least one change and
 * 14+ days since the last backup (or since the first change, if Vintry has never been backed up),
 * unless the user snoozed it with "Later".
 */
export function shouldShowBackupReminder(state: BackupReminderState, now: Date): boolean {
  if (state.changesSinceBackup <= 0) return false;
  if (state.snoozedUntil && now.getTime() < new Date(state.snoozedUntil).getTime()) return false;
  if (state.changesSinceBackup >= BACKUP_REMINDER_CHANGE_THRESHOLD) return true;

  const reference = state.lastBackupAt ?? state.firstChangeSinceBackup;
  if (!reference) return false;
  const days = (now.getTime() - new Date(reference).getTime()) / DAY_MS;
  return days >= BACKUP_REMINDER_DAYS;
}

/** An ISO timestamp `days` from now. */
export function snoozeUntil(now: Date, days: number = BACKUP_SNOOZE_DAYS): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

async function recordFirstChangeSinceBackup(): Promise<void> {
  const count = await getSetting<number>("changesSinceBackup", 0);
  // The counter just went from 0 to 1: this is the first change since the last backup (or ever).
  if (count === 1) await setSetting(FIRST_CHANGE_SINCE_BACKUP_KEY, nowIso());
}

/**
 * Watches committed commands so the "days since the first change" baseline exists even before
 * the collector has ever backed up. Returns an unsubscribe function; call once per mount.
 */
export function trackFirstChangeSinceBackup(): () => void {
  return onCommandCommitted(() => {
    void recordFirstChangeSinceBackup();
  });
}
