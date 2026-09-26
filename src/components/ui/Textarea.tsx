import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlClasses, useControlProps } from "./fieldContext";

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  const merged = useControlProps(props);
  return (
    <textarea
      rows={rows}
      className={clsx(controlClasses, "resize-y leading-relaxed", className)}
      {...merged}
    />
  );
}
