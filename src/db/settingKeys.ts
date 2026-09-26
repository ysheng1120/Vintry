// Kept in its own module (no database import) so test doubles of ./settings can share it.
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
