import { useEffect } from "react";
import { useLocation } from "react-router";
import { getSetting, setSetting } from "../../db/settings";
import { ONBOARDING_KEYS } from "../onboarding/settingKeys";
import { TOUR_STEPS } from "./steps";
import { Tour } from "./Tour";
import { startTour, stopTour, useTourActive } from "./tourStore";

/** Starts a tour that onboarding left pending, once the collector reaches Home. */
async function startPendingTour(): Promise<void> {
  if ((await getSetting<unknown>(ONBOARDING_KEYS.tourPending, false)) !== true) return;
  await setSetting(ONBOARDING_KEYS.tourPending, false);
  startTour();
}

async function recordTourDone(): Promise<void> {
  await setSetting(ONBOARDING_KEYS.tourDone, true);
  await setSetting(ONBOARDING_KEYS.tourPending, false);
}

/**
 * Mount once in the app shell. Renders the guided tour (R29) when onboarding just finished (on
 * the next Home render) or when Help starts it again. Finishing or skipping records "tourDone".
 */
export function TourHost() {
  const active = useTourActive();
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname !== "/") return;
    startPendingTour().catch(() => {
      // The tour is a nicety; a settings error must never block Home.
    });
  }, [pathname]);

  if (!active) return null;
  return (
    <Tour
      steps={TOUR_STEPS}
      onClose={() => {
        stopTour();
        void recordTourDone().catch(() => {});
      }}
    />
  );
}
