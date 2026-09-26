import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useBanner } from "../../app/useBanner";
import { getPlatform } from "../../lib/platform";

const BANNER_ID = "safari-tab";

/**
 * Mount once in the app shell. In a Safari tab on macOS (not the Dock app), keeps a warning
 * banner: Safari can remove the data of sites not visited for 7 days (R28).
 */
export function SafariTabWarning() {
  const { showBanner, hideBanner } = useBanner();
  const navigate = useNavigate();
  const [inSafariTab] = useState(() => {
    const platform = getPlatform();
    return platform.safariOnMac && !platform.standalone;
  });

  useEffect(() => {
    if (!inSafariTab) return;
    showBanner({
      id: BANNER_ID,
      tone: "warning",
      priority: 5,
      title: "Add Vintry to your Dock to keep your cellar safe",
      description:
        "Safari can remove data of websites you have not visited for 7 days. Choose File → Add to Dock, then use Vintry from the Dock.",
      action: { label: "Show me how", onClick: () => void navigate("/help#install") },
    });
    return () => hideBanner(BANNER_ID);
  }, [inSafariTab, showBanner, hideBanner, navigate]);

  return null;
}
