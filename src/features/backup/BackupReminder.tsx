import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useBanner } from "../../app/useBanner";
import { setSetting, useSetting } from "../../db/settings";
import {
  BACKUP_SNOOZE_UNTIL_KEY,
  FIRST_CHANGE_SINCE_BACKUP_KEY,
  shouldShowBackupReminder,
  snoozeUntil,
  trackFirstChangeSinceBackup,
} from "./reminder";

const BANNER_ID = "backup-reminder";

/**
 * Shows the "time for a backup" banner (R22) once 20 changes pile up, or 14+ days pass since the
 * last backup (or the first change, if never backed up). Renders nothing itself; the app shell
 * mounts it once so its banner is available everywhere.
 */
export default function BackupReminder() {
  const { showBanner, hideBanner } = useBanner();
  const navigate = useNavigate();

  // Raw keys (matching db/settings's SETTING_KEYS), not the object itself: the router smoke
  // test's settings mock only implements useSetting/getSetting/setSetting, not SETTING_KEYS.
  const changesSinceBackup = useSetting<number>("changesSinceBackup", 0);
  const lastBackupAt = useSetting<string | null>("lastBackupAt", null);
  const firstChangeSinceBackup = useSetting<string | null>(FIRST_CHANGE_SINCE_BACKUP_KEY, null);
  const snoozedUntil = useSetting<string | null>(BACKUP_SNOOZE_UNTIL_KEY, null);

  useEffect(() => trackFirstChangeSinceBackup(), []);

  useEffect(() => {
    const show = shouldShowBackupReminder(
      { changesSinceBackup, lastBackupAt, firstChangeSinceBackup, snoozedUntil },
      new Date(),
    );
    if (!show) return;

    showBanner({
      id: BANNER_ID,
      tone: "warning",
      title: "Time for a backup",
      description:
        changesSinceBackup >= 20
          ? `You made ${changesSinceBackup} changes since your last backup.`
          : "It has been two weeks or more since your last backup.",
      action: { label: "Back up now", onClick: () => navigate("/backup") },
      secondaryAction: {
        label: "Later",
        onClick: () => {
          void setSetting(BACKUP_SNOOZE_UNTIL_KEY, snoozeUntil(new Date()));
          hideBanner(BANNER_ID);
        },
      },
    });
    return () => hideBanner(BANNER_ID);
  }, [
    changesSinceBackup,
    lastBackupAt,
    firstChangeSinceBackup,
    snoozedUntil,
    showBanner,
    hideBanner,
    navigate,
  ]);

  return null;
}
