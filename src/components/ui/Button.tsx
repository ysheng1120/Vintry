import type { ComponentProps, ReactNode } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { Spinner } from "./Spinner";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy, and blocks clicks. */
  loading?: boolean;
  /** Icon shown before the label. */
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
