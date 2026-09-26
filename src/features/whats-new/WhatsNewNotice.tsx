import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/ui/useToast";
import { changelogEntry } from "../../content/changelog";
import { getSetting, setSetting } from "../../db/settings";
import { ONBOARDING_KEYS } from "../onboarding/settingKeys";

/**
 * Decides whether this launch shows "What's new". Records the running version, so the notice
 * shows once per version. The very first run (not onboarded, nothing seen yet) stays quiet.
 */
async function shouldShowWhatsNew(version: string): Promise<boolean> {
  const lastSeen = await getSetting<unknown>(ONBOARDING_KEYS.lastSeenVersion, null);
  if (lastSeen === version) return false;
  const onboarded = (await getSetting<unknown>(ONBOARDING_KEYS.onboardingDone, false)) === true;
  await setSetting(ONBOARDING_KEYS.lastSeenVersion, version);
  return lastSeen !== null || onboarded;
}

/** Mount once in the app shell: after an update, a one-time toast links to What's New (R30). */
export function WhatsNewNotice() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const version = __APP_VERSION__;
    shouldShowWhatsNew(version)
      .then((show) => {
        if (!show) return;
        toast({
          title: `What's new in version ${version}`,
          description: changelogEntry(version)?.headline ?? "See the list of changes.",
          duration: 15000,
          action: { label: "See what's new", onClick: () => void navigate("/whats-new") },
        });
      })
      .catch(() => {
        // A notice must never block the app.
      });
  }, [toast, navigate]);

  return null;
}
