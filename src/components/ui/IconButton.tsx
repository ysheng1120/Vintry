import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children"> {
  /** Accessible name, also shown as a tooltip. */
  label: string;
  icon: ReactNode;
  variant?: "ghost" | "secondary" | "primary";
  size?: "sm" | "md";
}

const variants = {
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-xl transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-5",
        size === "md" ? "size-10" : "size-10 [&_svg]:size-4",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
