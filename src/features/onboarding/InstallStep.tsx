import { AppWindow, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useInstallPrompt, type PlatformInfo } from "../../lib/platform";
import { StepLayout, type StepProps } from "./StepLayout";

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-2 rounded-2xl border border-border bg-surface p-5 pl-10 text-ink shadow-card marker:font-semibold marker:text-ink-subtle">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

/** Safari in a tab: ask for Add to Dock first, because Safari can evict tab data (R28). */
function SafariInstall({ headingRef, onNext }: StepProps) {
  return (
    <StepLayout
      headingRef={headingRef}
      title="Add Vintry to your Dock first"
      intro="Safari can remove data of websites you have not visited for 7 days. It keeps the data of apps in your Dock, so your cellar is safe there."
      footer={
        <>
          <Button variant="ghost" onClick={onNext}>
            Continue in browser
          </Button>
          <p className="basis-full text-sm text-ink-subtle">
            If you continue here, Vintry keeps reminding you. You can also use Chrome or Edge.
          </p>
        </>
      }
    >
      <Steps
        items={[
          "In the menu bar, choose File → Add to Dock, then click Add.",
          "Open Vintry from your Dock and set it up there. The Dock app keeps its own data.",
          "Close this tab.",
        ]}
      />
    </StepLayout>
  );
}

/** Chrome and Edge: the browser's own install prompt, or menu instructions without it. */
function ChromiumInstall({ headingRef, onNext, edge }: StepProps & { edge: boolean }) {
  const { available, installed, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  async function install() {
    const outcome = await promptInstall();
    if (outcome === "accepted") onNext();
    else setDismissed(true);
  }

  const menuItem = edge ? "Apps → Install this site as an app" : "Install Vintry";
  return (
    <StepLayout
      headingRef={headingRef}
      title="Install Vintry as an app"
      intro="Installing gives Vintry its own icon and window, and it helps the browser keep your data."
      footer={
        <>
          {available && (
            <Button
              size="lg"
              icon={<AppWindow aria-hidden="true" className="size-5" />}
              onClick={install}
            >
              Install app
            </Button>
          )}
          <Button variant={available ? "ghost" : "primary"} size="lg" onClick={onNext}>
            {available ? "Not now" : "Continue"}
            {!available && <ArrowRight aria-hidden="true" className="size-5" />}
          </Button>
        </>
      }
    >
      {installed && (
        <p role="status" className="mb-4 font-medium text-success">
          Vintry is installed. You can open it from its own icon.
        </p>
      )}
      {!available && !installed && (
        <Steps
          items={[
            "Click the install icon at the right end of the address bar (a small screen with an arrow).",
            `Or open the browser menu and choose ${menuItem}.`,
          ]}
        />
      )}
      {dismissed && (
        <p className="mt-4 text-sm text-ink-muted">
          No problem. You can install Vintry later from the browser menu.
        </p>
      )}
    </StepLayout>
  );
}

/** Other browsers cannot install web apps on the desktop. */
function OtherInstall({ headingRef, onNext }: StepProps) {
  return (
    <StepLayout
      headingRef={headingRef}
      title="Install Vintry as an app"
      intro="This browser cannot install Vintry as an app. Vintry works here, but Chrome or Edge can give it its own icon and window."
      footer={
        <Button size="lg" onClick={onNext}>
          Continue
          <ArrowRight aria-hidden="true" className="size-5" />
        </Button>
      }
    />
  );
}

/** Step 2: install first (R26, R28). Skipped when Vintry already runs as an installed app. */
export function InstallStep(props: StepProps & { platform: PlatformInfo }) {
  const { platform, ...step } = props;
  if (platform.safariOnMac) return <SafariInstall {...step} />;
  if (platform.browser === "chrome" || platform.browser === "edge") {
    return <ChromiumInstall {...step} edge={platform.browser === "edge"} />;
  }
  return <OtherInstall {...step} />;
}
