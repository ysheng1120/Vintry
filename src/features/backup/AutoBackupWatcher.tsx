import { liveQuery } from "dexie";
import { useEffect, useRef } from "react";
import { useBanner } from "../../app/useBanner";
import {
  AUTO_BACKUP_PREPARE_MS,
  checkAutoBackup,
  createAutoBackupScheduler,
  getAutoBackupState,
  isNewChange,
  needsBackupAtStart,
  prepareBackup,
  readChangeSignal,
  runAutoBackup,
  useAutoBackupState,
  type AutoBackupScheduler,
  type ChangeSignal,
  type PreparedBackup,
} from "./autoBackup";

const BANNER_ID = "auto-backup-failed";

/**
 * Automatic backups through the local launcher. Checks once whether the launcher offers them;
 * without it, renders and does nothing. The app shell mounts it once, next to BackupReminder.
 */
export default function AutoBackupWatcher() {
  const state = useAutoBackupState();

  useEffect(() => {
    void checkAutoBackup();
  }, []);

  return state.kind === "on" ? <AutoBackupRunner error={state.error} /> : null;
}

/**
 * Backs up once at start if needed, about a minute after the last change, and right away when
 * the page is hidden or closed with a change waiting. A closing page can't wait for the
 * database, so a backup is read and kept ready shortly after each change. Routine success is
 * silent; a failure shows one quiet banner until a backup works again.
 */
function AutoBackupRunner({ error }: { error: string | null }) {
  const { showBanner, hideBanner } = useBanner();
  const schedulerRef = useRef<AutoBackupScheduler | null>(null);

  useEffect(() => {
    let scheduler: AutoBackupScheduler | null = createAutoBackupScheduler(runAutoBackup);
    schedulerRef.current = scheduler;
    let previous: ChangeSignal | null = null;
    // Counts changes, so a prepared backup is used only while nothing changed after it.
    let changeCount = 0;
    let prepared: { backup: PreparedBackup; changeCount: number } | null = null;
    let prepareTimer: ReturnType<typeof setTimeout> | undefined;

    function prepareSoon() {
      prepared = null;
      clearTimeout(prepareTimer);
      prepareTimer = setTimeout(() => {
        const count = changeCount;
        prepareBackup()
          .then((backup) => {
            if (count === changeCount) prepared = { backup, changeCount: count };
          })
          .catch(() => {
            // The minute-later backup reads the database again anyway.
          });
      }, AUTO_BACKUP_PREPARE_MS);
    }

    const subscription = liveQuery(readChangeSignal).subscribe({
      next: (signal) => {
        if (previous === null) {
          const current = getAutoBackupState();
          if (current.kind === "on" && needsBackupAtStart(signal, current.status)) {
            void scheduler?.runNow();
          }
        } else if (isNewChange(previous, signal)) {
          changeCount += 1;
          scheduler?.changed();
          prepareSoon();
        }
        previous = signal;
      },
      error: () => {
        // The database is closing (an upgrade in another tab); the app shell handles that.
      },
    });

    const flush = () =>
      scheduler?.flushPending({
        keepalive: true,
        prepared: prepared?.changeCount === changeCount ? prepared.backup : undefined,
      });
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);

    return () => {
      subscription.unsubscribe();
      clearTimeout(prepareTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      scheduler?.dispose();
      scheduler = null;
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!error) {
      hideBanner(BANNER_ID);
      return;
    }
    showBanner({
      id: BANNER_ID,
      tone: "warning",
      title: "Automatic backups aren't working",
      description: error,
      action: { label: "Try again", onClick: () => void schedulerRef.current?.runNow() },
      onDismiss: () => {},
    });
  }, [error, showBanner, hideBanner]);

  useEffect(() => () => hideBanner(BANNER_ID), [hideBanner]);

  return null;
}
