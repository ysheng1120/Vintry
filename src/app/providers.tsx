import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "../components/ui/Toast";
import { onVersionChange } from "../db/db";
import { onCommandCommitted } from "../domain/commands/core";
import { purgeDeleted } from "../domain/commands/wines";
import { pruneHistory } from "../domain/historyRetention";
import { BannerProvider } from "./Banners";
import { useBanner } from "./useBanner";
import { browser } from "./browser";
import { ThemeController } from "./ThemeController";
import { requestPersistentStorage } from "./storage";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * App-wide context and background behaviour: toasts, banners, theme, update prompt, and the
 * "updated in another tab" notice. Wraps every route, including the full-screen /welcome.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <BannerProvider>
        <ThemeController />
        <UpdatePrompt />
        <VersionChangeBanner />
        <AppLifecycle />
        {children}
      </BannerProvider>
    </ToastProvider>
  );
}

/** R31 / KTD16: another tab upgraded the database, so this tab closed it and must reload. */
function VersionChangeBanner() {
  const { showBanner } = useBanner();
  useEffect(
    () =>
      onVersionChange(() => {
        showBanner({
          id: "db-version-change",
          tone: "warning",
          priority: 20,
          title: "Vintry was updated in another tab",
          description: "Reload this tab to keep working with your latest data.",
          action: { label: "Reload", onClick: () => browser.reload() },
        });
      }),
    [showBanner],
  );
  return null;
}

/**
 * Start-up housekeeping: purge wines deleted more than 30 days ago (KTD8), then clear old changes
 * from History (`pruneHistory`), and ask the browser to keep Vintry's data once the collector
 * makes their first real change (R23).
 */
function AppLifecycle() {
  useEffect(() => {
    purgeDeleted()
      .catch(() => undefined)
      .then(() => pruneHistory())
      .catch(() => {
        // Purging and pruning are housekeeping; a failure must never block the app.
      });
    return onCommandCommitted(() => {
      void requestPersistentStorage();
    });
  }, []);
  return null;
}
