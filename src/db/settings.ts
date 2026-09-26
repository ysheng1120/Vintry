import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

/** Known setting keys. Other units may add their own string keys. */
export const SETTING_KEYS = {
  apiKey: "apiKey",
  model: "model",
  currency: "currency",
  theme: "theme",
  onboardingDone: "onboardingDone",
  tourDone: "tourDone",
  lastBackupAt: "lastBackupAt",
  changesSinceBackup: "changesSinceBackup",
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined || row.value === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

/** Live value of a setting; returns `fallback` while loading and when unset. */
export function useSetting<T>(key: string, fallback: T): T {
  const value = useLiveQuery(async () => (await db.settings.get(key))?.value, [key]);
  return value === undefined ? fallback : (value as T);
}

/** Adds one to "changesSinceBackup". Call inside the writing transaction. */
export async function bumpChangesSinceBackup(): Promise<void> {
  const current = await getSetting<number>(SETTING_KEYS.changesSinceBackup, 0);
  await setSetting(SETTING_KEYS.changesSinceBackup, (Number(current) || 0) + 1);
}
