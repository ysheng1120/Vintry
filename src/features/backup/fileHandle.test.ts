import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKUPS_KEPT,
  chooseBackupFolder,
  directoryPickerSupported,
  writeBackupToFolder,
} from "./fileHandle";

/** A minimal in-memory stand-in for a FileSystemDirectoryHandle, for tests. */
function fakeDirectoryHandle(
  initialFiles: string[] = [],
  options: { writeError?: Error; abort?: () => Promise<void> } = {},
) {
  const files = new Set(initialFiles);
  const written: Record<string, string> = {};
  const removed: string[] = [];
  const abort = vi.fn(options.abort ?? (async () => {}));
  const handle: FileSystemDirectoryHandle = {
    kind: "directory",
    name: "vintry-backups",
    queryPermission: vi.fn(async () => "granted" as PermissionState),
    requestPermission: vi.fn(async () => "granted" as PermissionState),
    getFileHandle: vi.fn(async (name: string) => {
      files.add(name);
      return {
        kind: "file",
        name,
        createWritable: async () => ({
          write: async (contents: string) => {
            if (options.writeError) throw options.writeError;
            written[name] = contents;
          },
          close: async () => {},
          abort,
        }),
      } as unknown as FileSystemFileHandle;
    }),
    removeEntry: vi.fn(async (name: string) => {
      files.delete(name);
      removed.push(name);
    }),
    entries: async function* () {
      for (const name of files) yield [name, { kind: "file", name }] as [string, FileSystemHandle];
    },
  } as unknown as FileSystemDirectoryHandle;
  return { handle, files, written, removed, abort };
}

describe("directoryPickerSupported", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });

  it("is false when the browser has no showDirectoryPicker", () => {
    expect(directoryPickerSupported()).toBe(false);
  });

  it("is true when the browser exposes showDirectoryPicker", () => {
    window.showDirectoryPicker = vi.fn();
    expect(directoryPickerSupported()).toBe(true);
  });
});

describe("chooseBackupFolder", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });

  it("returns null when the browser doesn't support the picker", async () => {
    expect(await chooseBackupFolder()).toBeNull();
  });

  it("returns null when the user cancels the picker", async () => {
    window.showDirectoryPicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    expect(await chooseBackupFolder()).toBeNull();
  });

  it("returns the chosen handle", async () => {
    const { handle } = fakeDirectoryHandle();
    window.showDirectoryPicker = vi.fn(async () => handle);
    expect(await chooseBackupFolder()).toBe(handle);
  });
});

describe("writeBackupToFolder", () => {
  it("writes the file's contents", async () => {
    const { handle, written } = fakeDirectoryHandle();
    await writeBackupToFolder(handle, "vintry-backup-2026-09-26.json", '{"app":"vintry"}');
    expect(written["vintry-backup-2026-09-26.json"]).toBe('{"app":"vintry"}');
  });

  it("throws a plain-language error when permission is refused", async () => {
    const { handle } = fakeDirectoryHandle();
    handle.queryPermission = vi.fn(async () => "denied" as PermissionState);
    handle.requestPermission = vi.fn(async () => "denied" as PermissionState);
    await expect(
      writeBackupToFolder(handle, "vintry-backup-2026-09-26.json", "{}"),
    ).rejects.toThrow(/permission/i);
  });

  it("keeps only the newest 10 backup files", async () => {
    const older = Array.from(
      { length: 12 },
      (_, i) => `vintry-backup-2026-01-${String(i + 1).padStart(2, "0")}.json`,
    );
    const { handle, files, removed } = fakeDirectoryHandle(older);
    await writeBackupToFolder(handle, "vintry-backup-2026-09-26.json", "{}");

    expect(files.size).toBe(BACKUPS_KEPT);
    // The newest files (by date in the name) survive; the oldest are removed.
    expect(files.has("vintry-backup-2026-09-26.json")).toBe(true);
    expect(files.has("vintry-backup-2026-01-01.json")).toBe(false);
    expect(removed).toContain("vintry-backup-2026-01-01.json");
    expect(removed).toContain("vintry-backup-2026-01-02.json");
  });

  it("aborts the writable stream and rethrows when write() fails", async () => {
    const writeError = new Error("disk full");
    const { handle, abort } = fakeDirectoryHandle([], { writeError });
    await expect(
      writeBackupToFolder(handle, "vintry-backup-2026-09-26.json", "{}"),
    ).rejects.toThrow("disk full");
    expect(abort).toHaveBeenCalled();
  });

  it("resolves even when pruning old backups fails, since the file was already written", async () => {
    const older = Array.from(
      { length: 12 },
      (_, i) => `vintry-backup-2026-01-${String(i + 1).padStart(2, "0")}.json`,
    );
    const { handle, written } = fakeDirectoryHandle(older);
    handle.removeEntry = vi.fn(async () => {
      throw new Error("remove failed");
    });
    await expect(
      writeBackupToFolder(handle, "vintry-backup-2026-09-26.json", "{}"),
    ).resolves.toBeUndefined();
    expect(written["vintry-backup-2026-09-26.json"]).toBe("{}");
  });
});
