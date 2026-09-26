import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { controlClasses, useControlProps } from "./fieldContext";

export type SelectProps = ComponentProps<"select">;

/** Native select (best keyboard and screen-reader support) with a styled chevron. */
export function Select({ className, children, ...props }: SelectProps) {
  const merged = useControlProps(props);
  return (
    <div className="relative">
      <select
        className={clsx(controlClasses, "cursor-pointer appearance-none pr-9", className)}
        {...merged}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
}
