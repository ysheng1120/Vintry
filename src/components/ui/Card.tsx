import clsx from "clsx";
import type { ComponentProps } from "react";

export interface CardProps extends ComponentProps<"div"> {
  padding?: "none" | "sm" | "md" | "lg";
  /** Adds hover feedback for cards that act as links or buttons. */
  interactive?: boolean;
}

const paddings = { none: "", sm: "p-3", md: "p-5", lg: "p-6 sm:p-7" };

export function Card({ padding = "md", interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-border bg-surface shadow-card",
        paddings[padding],
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-150 hover:border-border-strong hover:shadow-raised",
        className,
      )}
      {...rest}
    />
  );
}
