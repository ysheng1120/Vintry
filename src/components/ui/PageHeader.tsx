import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small text above the title, e.g. a region or category. */
  eyebrow?: ReactNode;
  /** Buttons shown on the right (they wrap below the title in narrow windows). */
  actions?: ReactNode;
  /** A "back" link shown above the title. */
  back?: { to: string; label: string };
  className?: string;
}

/** The page's H1 plus optional subtitle and actions. Use exactly one per page. */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  back,
  className,
}: PageHeaderProps) {
  return (
    <header className={clsx("mb-8", className)}>
      {back && (
        <Link
          to={back.to}
          className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-semibold tracking-[0.12em] text-accent-ink uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl font-semibold text-balance sm:text-[2.25rem]">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
