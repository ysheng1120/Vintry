import { Camera, ChevronRight, FileSpreadsheet, MessageSquareText, PenLine } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router";
import { useAiStatus, type AiStatus } from "../../ai/useAiStatus";
import { PageHeader } from "../../components/ui/PageHeader";

interface AddOption {
  to: string;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Needs the AI key; the page itself explains how to add one (R18). */
  ai?: boolean;
}

const OPTIONS: AddOption[] = [
  {
    to: "/add/scan",
    title: "Scan a label",
    description: "Take or upload a photo and Vintry fills in the details.",
    icon: Camera,
    ai: true,
  },
  {
    to: "/add/describe",
    title: "Describe it",
    description: "Type one sentence, like “6 bottles of 2019 Ridge Monte Bello”.",
    icon: MessageSquareText,
    ai: true,
  },
  {
    to: "/add/manual",
    title: "Add by hand",
    description: "A short form. Works offline and without an AI key.",
    icon: PenLine,
  },
  {
    to: "/import",
    title: "Import a file",
    description: "Bring in a CSV from CellarTracker, Vivino, or a spreadsheet.",
    icon: FileSpreadsheet,
  },
];

/** A short note on an AI tile when AI cannot run; null when it is ready. */
function aiNote(status: AiStatus): string | null {
  if (status.state === "no-key") return "Needs AI key";
  if (status.state === "unavailable") {
    return navigator.onLine ? "AI unavailable right now" : "You are offline";
  }
  return null;
}

/** The four ways to add wine. AI tiles still open their page, which offers the manual path. */
export default function AddHubPage() {
  const status = useAiStatus();
  const note = aiNote(status);
  // Without a key, the ways that work today come first.
  const options =
    status.state === "no-key"
      ? [...OPTIONS.filter((o) => !o.ai), ...OPTIONS.filter((o) => o.ai)]
      : OPTIONS;
  return (
    <>
      <PageHeader title="Add wine" subtitle="Choose the quickest way for you." />
      <ul className="grid gap-4 md:grid-cols-2">
        {options.map(({ to, title, description, icon: Icon, ai }) => (
          <li key={to}>
            <Link
              to={to}
              className="group flex h-full items-start gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
            >
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"
              >
                <Icon className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-semibold text-ink">{title}</span>
                <span className="mt-1 block text-sm text-ink-muted">{description}</span>
                {ai && note && (
                  <span className="mt-2 inline-block rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                    {note}
                  </span>
                )}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="mt-3 size-5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
