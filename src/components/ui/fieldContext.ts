import { createContext, useContext } from "react";

export interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  label: string;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/** Read by Input, Textarea, Select, and Stepper to pick up id, description, and state. */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** Shared control styling for text-like inputs, without a width. */
export const controlBaseClasses =
  "min-h-10 rounded-xl border border-border-strong bg-surface px-3 py-2 text-[0.95rem] text-ink " +
  "placeholder:text-ink-subtle transition-colors duration-150 hover:border-ink-subtle " +
  "focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-ring/30 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:outline-danger/30";

/** Full-width control styling (Input, Textarea, Select). */
export const controlClasses = `w-full ${controlBaseClasses}`;

/** Merge Field context into a control's props; explicit props win. */
export function useControlProps<
  T extends {
    id?: string;
    required?: boolean;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  },
>(props: T): T {
  const field = useFieldControl();
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    required: props.required ?? (field.required || undefined),
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}
