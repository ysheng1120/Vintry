/**
 * The File System Access API isn't in TypeScript's bundled DOM lib yet; these are the few members
 * Vintry uses to pick a backup folder, write a dated file into it, and prune old ones (KTD15).
 */
declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

/** Setting key for the chosen backup folder's handle (structured-cloneable, stored as-is). */
export const BACKUP_FOLDER_SETTING_KEY = "backupFolder";

export const BACKUP_FILE_PREFIX = "vintry-backup-";

/** How many dated backup files stay in the chosen folder (KTD15). */
export const BACKUPS_KEPT = 10;

/** True on Chromium browsers that support choosing a folder (R21, KTD15). */
export function directoryPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Opens the browser's folder picker. Returns null if unsupported or the user cancels. */
export async function chooseBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!directoryPickerSupported()) return null;
  try {
    return await window.showDirectoryPicker!({ id: "vintry-backups", mode: "readwrite" });
  } catch {
    return null;
  }
}

async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const already = await handle.queryPermission?.({ mode: "readwrite" });
  if (already === "granted") return true;
  const granted = await handle.requestPermission?.({ mode: "readwrite" });
  return granted === "granted";
}

function isBackupFile(name: string, kind: string): boolean {
  return kind === "file" && name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(".json");
}

/** Removes every backup file in `handle` past the newest `BACKUPS_KEPT` (dated names sort in order). */
async function pruneOldBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (isBackupFile(name, entry.kind)) names.push(name);
  }
  const stale = names.sort().reverse().slice(BACKUPS_KEPT);
  for (const name of stale) await handle.removeEntry(name);
}

/** Writes a dated backup file into the chosen folder and prunes to the newest 10 (KTD15). */
export async function writeBackupToFolder(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  contents: string,
): Promise<void> {
  const ok = await ensureWritable(handle);
  if (!ok) throw new Error("Vintry needs permission to write to this folder.");
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
  await pruneOldBackups(handle);
}
