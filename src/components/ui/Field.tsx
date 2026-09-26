import clsx from "clsx";
import { useId, type ReactNode } from "react";
import { FieldContext } from "./fieldContext";

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  id,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider
      value={{ id: controlId, describedBy, invalid: Boolean(error), required, label }}
    >
      <div className={clsx("flex flex-col gap-1.5", className)}>
        <label
          htmlFor={controlId}
          className={clsx("text-sm font-medium text-ink", hideLabel && "sr-only")}
        >
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-primary">
              *
            </span>
          )}
        </label>
        {children}
        {error && (
          <p id={errorId} className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {hint && (
          <p id={hintId} className="text-sm text-ink-subtle">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
