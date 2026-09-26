import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { MORE_LINKS } from "../../app/navItems";
import { PageHeader } from "../../components/ui/PageHeader";

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" subtitle="Everything else in Vintry." />
      <ul className="grid gap-3 md:grid-cols-2">
        {MORE_LINKS.map(({ to, label, description, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="group flex min-h-16 items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-primary"
              >
                <Icon className="size-5" />
              </span>
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
    </>
  );
}
