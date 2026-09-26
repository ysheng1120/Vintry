import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect } from "react";
import { useBanner } from "../../app/useBanner";
import { getSetting, setSetting } from "../../db/settings";
import { clearSampleCellar } from "../../domain/commands/sample";
import { onCommandCommitted } from "../../domain/commands/core";
import { useCommandFeedback } from "../cellar/feedback";
import { countSampleWines, isRealAdd } from "./firstRun";
import { ONBOARDING_KEYS } from "./settingKeys";

const SAMPLE_BANNER_ID = "sample-cellar";
const ASK_BANNER_ID = "sample-cellar-ask";

async function safeSampleCount(): Promise<number> {
  try {
    return await countSampleWines();
  } catch {
    return 0;
  }
}

/**
 * Mount once in the app shell. While sample wines exist, a banner says so and offers "Clear
 * sample data" (R24). After the collector's first real add, it asks once whether to clear them.
 */
export function SampleDataWatcher() {
  const { showBanner, hideBanner } = useBanner();
  const { done, failed } = useCommandFeedback();
  const sampleCount = useLiveQuery(safeSampleCount, [], 0);

  const clear = useCallback(async () => {
    try {
      const result = await clearSampleCellar();
      hideBanner(ASK_BANNER_ID);
      done(result);
    } catch (error) {
      failed(error, "Couldn't clear the sample cellar");
    }
  }, [done, failed, hideBanner]);

  useEffect(() => {
    if (sampleCount === 0) {
      hideBanner(SAMPLE_BANNER_ID);
      hideBanner(ASK_BANNER_ID);
      return;
    }
    showBanner({
      id: SAMPLE_BANNER_ID,
      tone: "info",
      priority: 2,
      title: "You are exploring a sample cellar",
      description: "Sample wines are marked. Clear them in one click when you are ready.",
      action: { label: "Clear sample data", onClick: () => void clear() },
    });
  }, [sampleCount, showBanner, hideBanner, clear]);

  useEffect(
    () =>
      onCommandCommitted((result) => {
        void (async () => {
          if ((await getSetting<unknown>(ONBOARDING_KEYS.sampleClearAsked, false)) === true) return;
          if (!(await isRealAdd(result)) || (await safeSampleCount()) === 0) return;
          await setSetting(ONBOARDING_KEYS.sampleClearAsked, true);
          showBanner({
            id: ASK_BANNER_ID,
            tone: "primary",
            priority: 3,
            title: "Clear the sample cellar?",
            description: "You added your own wine. Your wines stay; only the samples go.",
            action: { label: "Clear sample data", onClick: () => void clear() },
            secondaryAction: { label: "Keep samples", onClick: () => hideBanner(ASK_BANNER_ID) },
          });
        })().catch(() => {
          // Asking is a nicety; never let it break the change that triggered it.
        });
      }),
    [showBanner, hideBanner, clear],
  );

  return null;
}
