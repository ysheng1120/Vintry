import { db } from "../../db/db";
import { getSetting, setSetting } from "../../db/settings";
import type { CommandResult } from "../../domain/commands/core";
import { ONBOARDING_KEYS } from "./settingKeys";

/**
 * Whether this launch should open onboarding (R28): not for anyone who finished it, and not for
 * a collector who already has wines (they used Vintry before onboarding existed, or restored).
 * Errors count as "no": a database problem must never trap the collector on /welcome.
 */
export async function needsOnboarding(): Promise<boolean> {
  try {
    if ((await getSetting<unknown>(ONBOARDING_KEYS.onboardingDone, false)) === true) return false;
    if ((await db.wines.count()) > 0) {
      await setSetting(ONBOARDING_KEYS.onboardingDone, true);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Marks onboarding done; the tour then starts on the next Home render (TourHost). */
export async function finishOnboarding(): Promise<void> {
  await setSetting(ONBOARDING_KEYS.onboardingDone, true);
  await setSetting(ONBOARDING_KEYS.tourPending, true);
}

/** Sample wines still in the cellar (R24). */
export async function countSampleWines(): Promise<number> {
  return db.wines.filter((wine) => wine.isSample && !wine.deletedAt).count();
}

/** True when a committed change added the collector's own wine or bottles (not samples). */
export async function isRealAdd(result: CommandResult): Promise<boolean> {
  if (!result.batchId) return false;
  const batch = await db.eventBatches.get(result.batchId);
  if (!batch || batch.source === "sample") return false;
  return batch.changes.some(
    (change) =>
      (change.table === "wines" || change.table === "lots") &&
      change.before === null &&
      change.after !== null &&
      change.after.isSample !== true,
  );
}
