import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap " +
  "transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-55 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-card hover:bg-primary-hover active:bg-primary-hover",
  secondary:
    "border border-border-strong bg-surface text-ink hover:bg-surface-muted active:bg-surface-sunken",
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink active:bg-surface-sunken",
  danger: "bg-danger text-on-primary shadow-card hover:bg-danger-hover active:bg-danger-hover",
};

/** Every size keeps the 40 px minimum click target (KTD18). */
const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-10 px-4 text-[0.95rem]",
  lg: "min-h-12 px-5 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  return clsx(base, buttonVariants[variant], buttonSizes[size], className);
}
