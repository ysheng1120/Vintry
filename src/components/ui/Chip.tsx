import clsx from "clsx";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

export interface ChipProps {
  children: ReactNode;
  /** Shows a × button; its accessible name is "Remove <text>". */
  onRemove?: () => void;
  /** Text used in the remove button's name when children is not plain text. */
  removeLabel?: string;
  className?: string;
}

/** A small tag, optionally removable (e.g. an active filter). */
export function Chip({ children, onRemove, removeLabel, className }: ChipProps) {
  const name = removeLabel ?? (typeof children === "string" ? children : "item");
  return (
    <span
      className={clsx(
        "inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface-muted pl-3 text-sm text-ink",
        onRemove ? "pr-1" : "pr-3",
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="inline-flex size-7 items-center justify-center rounded-full text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export interface FilterChipProps {
  children: ReactNode;
  selected: boolean;
  onToggle: (selected: boolean) => void;
  count?: number;
  /** Optional leading visual, e.g. a ColorDot. */
  icon?: ReactNode;
  className?: string;
}

/** A toggle button for filters; exposes aria-pressed. */
export function FilterChip({
  children,
  selected,
  onToggle,
  count,
  icon,
  className,
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(!selected)}
      className={clsx(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary-soft text-primary"
          : "border-border-strong bg-surface text-ink-muted hover:border-ink-subtle hover:text-ink",
        className,
      )}
    >
      {selected ? <Check aria-hidden="true" className="size-4" /> : icon}
      {children}
      {count !== undefined && (
        <span
          className={clsx(
            "rounded-full px-1.5 text-xs tabular-nums",
            selected ? "bg-surface/60" : "bg-surface-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
