import { ChevronRight, DatabaseBackup, LifeBuoy, Sparkles } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../components/ui/PageHeader";
import { AiKeySettings } from "./AiKeySettings";
import { ModelSettings } from "./ModelSettings";
import { PreferenceSettings } from "./PreferenceSettings";
import { Section } from "./Section";
import { UsageSettings } from "./UsageSettings";

const LINKS: {
  to: string;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    to: "/backup",
    label: "Backup",
    description: "Save or restore a copy of your cellar.",
    icon: DatabaseBackup,
  },
  {
    to: "/whats-new",
    label: "What's new",
    description: "Changes in each version.",
    icon: Sparkles,
  },
  { to: "/help", label: "Help", description: "How to use Vintry.", icon: LifeBuoy },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="AI key and model, usage, currency, and theme." />
      <div className="flex max-w-4xl flex-col gap-6">
        <Section
          title="AI"
          description="Optional. Add your own Claude API key to scan labels, describe wines, and ask the sommelier. AI features send the text, photo, or cellar details they use to Anthropic."
        >
          <AiKeySettings />
          <ModelSettings />
        </Section>

        <Section title="Usage" description="Tokens and estimated cost of your AI requests.">
          <UsageSettings />
        </Section>

        <Section title="Preferences">
          <PreferenceSettings />
        </Section>

        <nav aria-label="More settings">
          <ul className="grid gap-3 md:grid-cols-3">
            {LINKS.map(({ to, label, description, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="group flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
                >
                  <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{label}</span>
                    <span className="block text-sm text-ink-muted">{description}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
