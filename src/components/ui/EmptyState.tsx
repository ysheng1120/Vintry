import clsx from "clsx";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** One or more buttons or links. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center rounded-2xl border border-dashed border-border-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-7"
        >
          {icon}
        </div>
      )}
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && <p className="mt-2 max-w-md text-ink-muted">{description}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
