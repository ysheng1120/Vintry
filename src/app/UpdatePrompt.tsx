import { useEffect } from "react";
import { useRegisterSW } from "./pwaRegister";
import { useToast } from "../components/ui/useToast";
import { useBanner } from "./useBanner";

const UPDATE_BANNER_ID = "app-update";
const HOUR_MS = 60 * 60 * 1000;

/**
 * KTD16: the service worker is registered with registerType "prompt". When a new build is
 * waiting, show a banner; Reload activates it and reloads the page.
 */
export function UpdatePrompt() {
  const { showBanner, hideBanner } = useBanner();
  const { toast } = useToast();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Desktop tabs stay open for days; look for a new version every hour.
      if (!registration) return;
      window.setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, HOUR_MS);
    },
  });

  useEffect(() => {
    if (!needRefresh) {
      hideBanner(UPDATE_BANNER_ID);
      return;
    }
    showBanner({
      id: UPDATE_BANNER_ID,
      tone: "primary",
      priority: 10,
      title: "A new version of Vintry is available",
      description: "Reload to update. Your cellar stays as it is.",
      action: { label: "Reload", onClick: () => void updateServiceWorker(true) },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, showBanner, hideBanner, updateServiceWorker, setNeedRefresh]);

  useEffect(() => {
    if (!offlineReady) return;
    toast({
      title: "Vintry is ready to work offline",
      description: "You can open it without an internet connection.",
      tone: "success",
    });
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, toast]);

  return null;
}
