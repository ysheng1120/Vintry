import { setSetting } from "../db/settings";

/** Stored under the "persistRequested" setting after the browser answers. */
export interface PersistRequestRecord {
  granted: boolean;
  requestedAt: string;
}

let pending: Promise<boolean | null> | null = null;

/**
 * R23: ask the browser to keep Vintry's data (not evict it under storage pressure).
 * Call after the first real write. Asks at most once per session and skips the prompt when
 * storage is already persistent. Resolves to whether storage is persistent, or null when the
 * browser has no Storage API.
 */
export function requestPersistentStorage(): Promise<boolean | null> {
  pending ??= ask();
  return pending;
}

async function ask(): Promise<boolean | null> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== "function") return null;
  try {
    const already = typeof storage.persisted === "function" && (await storage.persisted());
    const granted = already || (await storage.persist());
    const record: PersistRequestRecord = { granted, requestedAt: new Date().toISOString() };
    await setSetting("persistRequested", record);
    return granted;
  } catch {
    return null;
  }
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

/** How much space Vintry uses and may use, in bytes; null when the browser cannot say. */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.estimate !== "function") return null;
  try {
    const { usage = 0, quota = 0 } = await storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
