import { Download, FolderCheck, FolderOpen, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  backupFileName,
  exportBackup,
  listSnapshots,
  markBackupDone,
  parseBackup,
  type BackupFile,
  type SnapshotSummary,
  backupCounts,
} from "../../db/backup";
import { getSetting, setSetting, useSetting } from "../../db/settings";
import { restoreBackupCommand, restoreSnapshotCommand, wipeAll } from "../../domain/commands";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/useToast";
import { db } from "../../db/db";
import { bottles } from "../../domain/labels";
import { formatDate, pluralize, toIsoDate } from "../../lib/format";
import { useCommandFeedback } from "../../app/commandFeedback";
import {
  AUTO_BACKUPS_KEPT,
  checkAutoBackup,
  formatSavedAgo,
  useAutoBackupState,
} from "./autoBackup";
import { buildCellarCsv } from "./cellarCsv";
import {
  BACKUP_FOLDER_SETTING_KEY,
  chooseBackupFolder,
  directoryPickerSupported,
  writeBackupToFolder,
} from "./fileHandle";

function downloadTextFile(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface TypedConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  word: string;
  confirmLabel: string;
  busy: boolean;
}

/**
 * A destructive action's confirmation, gated on typing an exact word (R21). The typed text lives
 * in a body that only mounts while open, so it always starts blank rather than needing an effect
 * to reset it.
 */
function TypedConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  word,
  confirmLabel,
  busy,
}: TypedConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      variant="dialog"
      size="sm"
      role="alertdialog"
      hideClose
      closeOnBackdrop={false}
    >
      {open && (
        <TypedConfirmBody
          word={word}
          confirmLabel={confirmLabel}
          busy={busy}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Sheet>
  );
}

function TypedConfirmBody({
  word,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: Pick<TypedConfirmDialogProps, "word" | "confirmLabel" | "busy"> & {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-5">
      <Field label={`Type "${word}" to confirm`}>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={busy}
          disabled={text.trim() !== word || busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Whether the launcher saves backups by itself, and where. Nothing shows while that is being
 * checked, so the page doesn't flicker between the two messages.
 */
function AutoBackupCard() {
  const autoBackup = useAutoBackupState();

  useEffect(() => {
    void checkAutoBackup();
  }, []);

  if (autoBackup.kind === "checking") return null;
  if (autoBackup.kind === "unavailable") {
    return (
      <Card padding="lg" className="space-y-2">
        <h2 className="text-lg font-medium text-ink">Automatic backups</h2>
        <p className="text-ink-muted">
          Automatic backups work when you start Vintry with the launcher (Start Vintry). Here, use
          Export backup below.
        </p>
      </Card>
    );
  }

  const { folder, latest } = autoBackup.status;
  return (
    <Card padding="lg" className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg font-medium text-ink">
        <FolderCheck aria-hidden="true" className="size-5 text-success" />
        Automatic backups
      </h2>
      <p className="text-ink-muted">
        On. Vintry saves a backup to{" "}
        <span className="font-medium [overflow-wrap:anywhere] text-ink">{folder}</span> after your
        changes. {latest ? `Last saved ${formatSavedAgo(latest.savedAt)}.` : "None saved yet."} The{" "}
        {AUTO_BACKUPS_KEPT} newest are kept.
      </p>
      <p className="text-sm text-ink-subtle">
        To restore, choose a file from that folder under Restore from backup.
      </p>
      {autoBackup.error && (
        <p className="text-sm font-medium text-danger">
          The last automatic backup didn't work: {autoBackup.error}
        </p>
      )}
    </Card>
  );
}

/** Export, backup, and restore, with a safety snapshot always taken first (R21, R22, R23). */
/** What a restore replaces with what, so a short or empty file is noticed before it is used. */
function restoreDescription(
  backup: BackupFile,
  current: { wines: number; bottles: number } | null,
): string {
  const counts = backupCounts(backup);
  const has =
    counts.wines === 0
      ? "It has no wines at all."
      : `It has ${pluralize(counts.wines, "wine")} and ${bottles(counts.bottles)}.`;
  const now = current
    ? ` This device has ${pluralize(current.wines, "wine")} and ${bottles(current.bottles)} now.`
    : "";
  return `This backup was made ${formatDate(backup.exportedAt)}. ${has}${now} Everything currently on this device will be replaced. A safety copy is saved first.`;
}

export default function BackupPage() {
  const { done, failed } = useCommandFeedback();
  const { toast } = useToast();

  // Raw keys (matching db/settings's SETTING_KEYS), not the object itself: the router smoke
  // test's settings mock only implements useSetting/getSetting/setSetting, not SETTING_KEYS.
  const lastBackupAt = useSetting<string | null>("lastBackupAt", null);
  const changesSinceBackup = useSetting<number>("changesSinceBackup", 0);
  const folderHandle = useSetting<FileSystemDirectoryHandle | null>(
    BACKUP_FOLDER_SETTING_KEY,
    null,
  );

  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  /** Wines and bottles on this device now, shown next to the backup's counts before a restore. */
  const [currentCounts, setCurrentCounts] = useState<{ wines: number; bottles: number } | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);
  const [pendingSnapshotId, setPendingSnapshotId] = useState<string | null>(null);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);

  const restoreInputRef = useRef<HTMLInputElement>(null);

  async function refreshSnapshots() {
    setSnapshots(await listSnapshots());
  }

  useEffect(() => {
    let alive = true;
    listSnapshots()
      .then((list) => {
        if (alive) setSnapshots(list);
      })
      .catch(() => {
        // Housekeeping only; an empty list just means none showed up yet.
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleExportBackup() {
    setExporting(true);
    try {
      const backup = await exportBackup();
      downloadTextFile(JSON.stringify(backup, null, 2), backupFileName(), "application/json");
      await markBackupDone();
      toast({ title: "Backup exported", tone: "success" });
    } catch (error) {
      failed(error, "Couldn't export a backup");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    setExportingCsv(true);
    try {
      const csv = await buildCellarCsv();
      downloadTextFile(csv, `vintry-cellar-${toIsoDate(new Date())}.csv`, "text/csv");
      toast({ title: "CSV exported", tone: "success" });
    } catch (error) {
      failed(error, "Couldn't export the CSV");
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleChooseFolder() {
    setChoosingFolder(true);
    try {
      const handle = await chooseBackupFolder();
      if (handle) {
        await setSetting(BACKUP_FOLDER_SETTING_KEY, handle);
        toast({ title: "Backup folder set" });
      }
    } finally {
      setChoosingFolder(false);
    }
  }

  async function handleBackUpNow() {
    const handle = await getSetting<FileSystemDirectoryHandle | null>(
      BACKUP_FOLDER_SETTING_KEY,
      null,
    );
    if (!handle) return;
    setBackingUp(true);
    try {
      const backup = await exportBackup();
      await writeBackupToFolder(handle, backupFileName(), JSON.stringify(backup));
      await markBackupDone();
      toast({ title: "Backed up to folder", tone: "success" });
    } catch (error) {
      failed(error, "Couldn't back up to that folder");
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestoreFileChosen(file: File) {
    setRestoreError(null);
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      setRestoreError(result.message);
      return;
    }
    const [wines, lots] = await Promise.all([db.wines.toArray(), db.lots.toArray()]);
    const wineIds = new Set(wines.filter((w) => !w.deletedAt).map((w) => w.id));
    setCurrentCounts({
      wines: wineIds.size,
      bottles: lots.filter((l) => wineIds.has(l.wineId)).reduce((sum, l) => sum + l.quantity, 0),
    });
    setPendingRestore(result.backup);
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    setRestoring(true);
    try {
      const result = await restoreBackupCommand.run(pendingRestore);
      setPendingRestore(null);
      done(result, { description: "A safety copy of your previous data was saved first." });
      void refreshSnapshots();
    } catch (error) {
      failed(error, "Restore didn't finish");
    } finally {
      setRestoring(false);
    }
  }

  async function confirmRestoreSnapshot() {
    if (!pendingSnapshotId) return;
    setRestoringSnapshotId(pendingSnapshotId);
    try {
      const result = await restoreSnapshotCommand.run({ snapshotId: pendingSnapshotId });
      setPendingSnapshotId(null);
      done(result);
      void refreshSnapshots();
    } catch (error) {
      failed(error, "Couldn't bring back that copy");
    } finally {
      setRestoringSnapshotId(null);
    }
  }

  async function confirmWipe() {
    setWiping(true);
    try {
      const result = await wipeAll();
      setShowWipeConfirm(false);
      done(result);
      void refreshSnapshots();
    } catch (error) {
      failed(error, "Couldn't erase your data");
    } finally {
      setWiping(false);
    }
  }

  return (
    <>
      <PageHeader title="Backup & restore" subtitle="Keep your records safe with a backup file." />

      <div className="space-y-6">
        <AutoBackupCard />

        <Card padding="lg" className="space-y-2">
          <h2 className="text-lg font-medium text-ink">Status</h2>
          <p className="text-ink-muted">
            Last backup:{" "}
            <span className="font-medium text-ink">
              {lastBackupAt ? formatDate(lastBackupAt) : "never"}
            </span>
          </p>
          <p className="text-ink-muted">
            Changes since: <span className="font-medium text-ink">{changesSinceBackup}</span>
          </p>
        </Card>

        <Card padding="lg" className="space-y-4">
          <h2 className="text-lg font-medium text-ink">Export</h2>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              icon={<Download aria-hidden="true" className="size-4" />}
              loading={exporting}
              onClick={handleExportBackup}
            >
              Export backup
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<Download aria-hidden="true" className="size-4" />}
              loading={exportingCsv}
              onClick={handleExportCsv}
            >
              Export CSV
            </Button>
          </div>

          {directoryPickerSupported() && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                type="button"
                variant="secondary"
                icon={<FolderOpen aria-hidden="true" className="size-4" />}
                loading={choosingFolder}
                onClick={handleChooseFolder}
              >
                {folderHandle ? "Change backup folder" : "Choose a backup folder"}
              </Button>
              {folderHandle && (
                <Button type="button" loading={backingUp} onClick={handleBackUpNow}>
                  Back up now
                </Button>
              )}
              {folderHandle && (
                <span className="text-sm text-ink-subtle">Keeps the newest 10 files there.</span>
              )}
            </div>
          )}
        </Card>

        <Card padding="lg" className="space-y-4">
          <h2 className="text-lg font-medium text-ink">Restore from backup</h2>
          <p className="text-ink-muted">
            Replaces everything on this device. A safety copy is saved first, and you can undo.
          </p>
          <Button
            type="button"
            variant="secondary"
            icon={<Upload aria-hidden="true" className="size-4" />}
            onClick={() => restoreInputRef.current?.click()}
          >
            Choose backup file
          </Button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Vintry backup file to restore"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleRestoreFileChosen(file);
            }}
          />
          {restoreError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {restoreError}
            </p>
          )}
        </Card>

        <Card padding="lg" className="space-y-4">
          <h2 className="text-lg font-medium text-ink">Safety copies on this device</h2>
          {snapshots.length === 0 ? (
            <p className="text-ink-muted">None yet. One is taken automatically before a restore.</p>
          ) : (
            <ul className="space-y-3">
              {snapshots.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-ink">{formatDate(snapshot.createdAt)}</p>
                    <p className="text-sm text-ink-subtle">
                      {snapshot.reason} · {snapshot.wineCount} wines, {snapshot.bottleCount} bottles
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw aria-hidden="true" className="size-4" />}
                    loading={restoringSnapshotId === snapshot.id}
                    onClick={() => setPendingSnapshotId(snapshot.id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="lg" className="space-y-4 border-danger/30">
          <h2 className="text-lg font-medium text-ink">Delete all data</h2>
          <p className="text-ink-muted">
            Erases every wine, bottle, note, location, wishlist item, and chat on this device. A
            safety copy is saved first, and you can undo.
          </p>
          <Button
            type="button"
            variant="danger"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={() => setShowWipeConfirm(true)}
          >
            Delete all data
          </Button>
        </Card>
      </div>

      <TypedConfirmDialog
        open={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        onConfirm={() => void confirmRestore()}
        title="Replace all data with this backup?"
        description={pendingRestore ? restoreDescription(pendingRestore, currentCounts) : undefined}
        word="REPLACE"
        confirmLabel="Replace data"
        busy={restoring}
      />

      <Sheet
        open={pendingSnapshotId !== null}
        onClose={() => setPendingSnapshotId(null)}
        title="Bring back this saved copy?"
        description="Your current data will be replaced. A safety copy of it is saved first, and you can undo."
        variant="dialog"
        size="sm"
        role="alertdialog"
        hideClose
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPendingSnapshotId(null)}
              disabled={restoringSnapshotId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={restoringSnapshotId !== null}
              onClick={() => void confirmRestoreSnapshot()}
            >
              Bring back this copy
            </Button>
          </>
        }
      />

      <TypedConfirmDialog
        open={showWipeConfirm}
        onClose={() => setShowWipeConfirm(false)}
        onConfirm={() => void confirmWipe()}
        title="Delete all data on this device?"
        description="This cannot be undone from here without restoring the safety copy Vintry saves first."
        word="DELETE"
        confirmLabel="Delete everything"
        busy={wiping}
      />
    </>
  );
}
