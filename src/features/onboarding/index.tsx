import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, BrandWordmark } from "../../app/Brand";
import { Button } from "../../components/ui/Button";
import { getPlatform } from "../../lib/platform";
import { InstallStep } from "./InstallStep";
import { KeyStep } from "./KeyStep";
import { StartStep } from "./StartStep";
import { WelcomeStep } from "./WelcomeStep";

type StepId = "welcome" | "install" | "key" | "start";

/**
 * First-run onboarding at /welcome (R28), full screen with no navigation: welcome, install
 * (skipped in an installed app), an optional AI key, and how to start.
 */
export default function WelcomePage() {
  const [platform] = useState(getPlatform);
  const steps = useMemo<StepId[]>(
    () =>
      platform.standalone ? ["welcome", "key", "start"] : ["welcome", "install", "key", "start"],
    [platform],
  );
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = steps[index] ?? "welcome";

  // Each new step moves focus to its heading, so screen readers announce it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  const onNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const stepProps = { headingRef, onNext };

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-10 flex items-center gap-3">
          <BrandMark className="size-10" />
          <BrandWordmark className="text-2xl" />
          <span className="flex-1" />
          {index > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </Button>
          )}
        </header>

        <main>
          {step === "welcome" && <WelcomeStep {...stepProps} />}
          {step === "install" && <InstallStep {...stepProps} platform={platform} />}
          {step === "key" && <KeyStep {...stepProps} />}
          {step === "start" && <StartStep headingRef={headingRef} />}
        </main>

        <footer className="mt-12 flex items-center gap-3 text-sm text-ink-subtle">
          <span>
            Step {index + 1} of {steps.length}
          </span>
          <span aria-hidden="true" className="flex gap-1.5">
            {steps.map((id, i) => (
              <span
                key={id}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-border-strong",
                )}
              />
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
}
