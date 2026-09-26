import { Outlet, ScrollRestoration } from "react-router";
import BackupReminder from "../features/backup/BackupReminder";
import { FirstRunRedirect } from "../features/onboarding/FirstRunRedirect";
import { SafariTabWarning } from "../features/onboarding/SafariTabWarning";
import { SampleDataWatcher } from "../features/onboarding/SampleDataWatcher";
import { TourHost } from "../features/tour/TourHost";
import { WhatsNewNotice } from "../features/whats-new/WhatsNewNotice";
import { BrandMark } from "./Brand";
import { AppProviders } from "./providers";

/** Top route: app-wide providers around both the main layout and full-screen pages. */
export function Root() {
  return (
    <AppProviders>
      <ScrollRestoration />
      <FirstRunRedirect />
      <BackupReminder />
      <SampleDataWatcher />
      <SafariTabWarning />
      <WhatsNewNotice />
      <TourHost />
      <Outlet />
    </AppProviders>
  );
}

/** Shown while the first screen's code loads. */
export function RootFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status">
      <BrandMark className="size-12 animate-pulse" />
      <span className="sr-only">Loading Vintry…</span>
    </div>
  );
}
