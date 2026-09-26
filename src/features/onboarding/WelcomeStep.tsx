import { ArrowRight, HandCoins, Lock, Zap } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { StepLayout, type StepProps } from "./StepLayout";

const PROMISES = [
  {
    icon: HandCoins,
    title: "Free to run",
    text: "No subscription. You pay only for your own AI use, if you want it.",
  },
  {
    icon: Lock,
    title: "Private",
    text: "Your cellar stays on your computer. AI features send only what they need to Anthropic.",
  },
  {
    icon: Zap,
    title: "Quick",
    text: "No account and nothing to sign up for. Start in a minute.",
  },
];

/** Step 1: what Vintry is, and its three promises. */
export function WelcomeStep({ headingRef, onNext }: StepProps) {
  return (
    <StepLayout
      headingRef={headingRef}
      title="Welcome to Vintry"
      intro="Your wine cellar, organised. Know what to drink and when, and ask a sommelier about your own bottles."
      footer={
        <Button size="lg" onClick={onNext}>
          Get started
          <ArrowRight aria-hidden="true" className="size-5" />
        </Button>
      }
    >
      <ul className="grid gap-4 sm:grid-cols-3">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <span
              aria-hidden="true"
              className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary"
            >
              <Icon className="size-5" />
            </span>
            <p className="font-display text-lg font-semibold text-ink">{title}</p>
            <p className="mt-1 text-sm text-ink-muted">{text}</p>
          </li>
        ))}
      </ul>
    </StepLayout>
  );
}
