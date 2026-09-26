import clsx from "clsx";
import { windowStatusFor, type WindowStatus } from "./windowStatus";

const segmentColour: Record<WindowStatus, string> = {
  hold: "bg-hold",
  ready: "bg-ready",
  "drink-soon": "bg-soon",
  "past-peak": "bg-past",
  "no-window": "bg-none",
};

export interface WindowBarProps {
  from?: number | null;
  to?: number | null;
  /** Current year; defaults to this year. */
  current?: number;
  /** "sm" hides the year labels (for dense lists). */
  size?: "sm" | "md";
  className?: string;
}

function describe(from: number | null | undefined, to: number | null | undefined, now: number) {
  if (from != null && to != null) return `Drinking window ${from}–${to}, now ${now}`;
  if (from != null) return `Drinking window from ${from}, now ${now}`;
  if (to != null) return `Drinking window until ${to}, now ${now}`;
  return `No drinking window, now ${now}`;
}

function edgeTransform(pct: number): string {
  if (pct < 8) return "translateX(0)";
  if (pct > 92) return "translateX(-100%)";
  return "translateX(-50%)";
}

/** A horizontal bar showing the drinking window and a marker for the current year. */
export function WindowBar({
  from,
  to,
  current = new Date().getFullYear(),
  size = "md",
  className,
}: WindowBarProps) {
  const status = windowStatusFor(from, to, current);
  const label = describe(from, to, current);

  if (status === "no-window") {
    return (
      <p data-status={status} className={clsx("text-sm text-ink-subtle", className)}>
        No drinking window yet
      </p>
    );
  }

  // Scale: a year of padding each side, and room for open-ended windows to trail off.
  const start = Math.min(from ?? current - 4, current) - 1;
  const end = Math.max(to ?? current + 4, current, from ?? current) + 1;
  const span = Math.max(end - start, 1);
  const pct = (year: number) => ((year - start) / span) * 100;

  const segStart = pct(from ?? start);
  const segEnd = pct(to != null ? to + 1 : end);
  const nowPct = Math.min(100, Math.max(0, pct(current + 0.5)));

  return (
    <div
      role="img"
      aria-label={label}
      data-status={status}
      className={clsx("w-full", size === "md" ? "pt-1" : "", className)}
    >
      <div aria-hidden="true" className="relative h-2 rounded-full bg-surface-sunken">
        <div
          className={clsx(
            "absolute inset-y-0 rounded-full",
            segmentColour[status],
            from == null && "rounded-l-none opacity-80",
            to == null && "rounded-r-none opacity-80",
          )}
          style={{ left: `${segStart}%`, width: `${Math.max(segEnd - segStart, 1.5)}%` }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow-card"
          style={{ left: `${nowPct}%` }}
        />
      </div>
      {size === "md" && (
        <div
          aria-hidden="true"
          className="relative mt-1.5 h-5 text-xs text-ink-subtle tabular-nums"
        >
          {from != null && (
            <span
              className="absolute"
              style={{ left: `${segStart}%`, transform: edgeTransform(segStart) }}
            >
              {from}
            </span>
          )}
          {to != null && (
            <span
              className="absolute"
              style={{ left: `${segEnd}%`, transform: edgeTransform(segEnd) }}
            >
              {to}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
