import { Camera, ChevronRight, FileSpreadsheet, MessageSquareText, PenLine } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

interface AddOption {
  to: string;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const OPTIONS: AddOption[] = [
  {
    to: "/add/scan",
    title: "Scan a label",
    description: "Take or upload a photo and Vintry fills in the details.",
    icon: Camera,
  },
  {
    to: "/add/describe",
    title: "Describe it",
    description: "Type one sentence, like “6 bottles of 2019 Ridge Monte Bello”.",
    icon: MessageSquareText,
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

// Hub from the app shell (U4); the add units may refine it.
export default function AddHubPage() {
  return (
    <>
      <PageHeader title="Add wine" subtitle="Choose the quickest way for you." />
      <ul className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map(({ to, title, description, icon: Icon }) => (
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

function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} back={{ to: "/add", label: "Add wine" }} />
      <EmptyState icon={<PenLine />} title="On its way" description={description} />
    </>
  );
}

export function ScanPage() {
  return <Placeholder title="Scan a label" description="Label scanning arrives soon." />;
}

export function DescribePage() {
  return <Placeholder title="Describe a wine" description="Describing in words arrives soon." />;
}

export function ManualPage() {
  return <Placeholder title="Add by hand" description="The add form arrives soon." />;
}
