import clsx from "clsx";
import type { ComponentProps } from "react";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "hold"
  | "ready"
  | "drink-soon"
  | "past-peak"
  | "no-window";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  hold: "bg-hold-soft text-hold",
  ready: "bg-ready-soft text-ready",
  "drink-soon": "bg-soon-soft text-soon",
  "past-peak": "bg-past-soft text-past",
  "no-window": "bg-none-soft text-none",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
