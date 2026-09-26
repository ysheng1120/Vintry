/**
 * Setting keys used by onboarding, the tour, the sample cellar, and What's New. Plain strings
 * (the first two match SETTING_KEYS in src/db/settings) so the shell tests' settings mock works.
 */
export const ONBOARDING_KEYS = {
  /** True once the collector finished onboarding (or already had wines). */
  onboardingDone: "onboardingDone",
  /** True once the tour was completed or skipped. */
  tourDone: "tourDone",
  /** Set when onboarding ends; the tour starts on the next Home render. */
  tourPending: "tourPending",
  /** The app version whose "What's new" notice was last shown. */
  lastSeenVersion: "lastSeenVersion",
  /** True once Vintry asked whether to clear the samples after the first real add. */
  sampleClearAsked: "sampleClearAsked",
} as const;
