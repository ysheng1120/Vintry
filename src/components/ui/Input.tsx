import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlClasses, useControlProps } from "./fieldContext";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  const merged = useControlProps(props);
  return <input type={type} className={clsx(controlClasses, className)} {...merged} />;
}
