import clsx from "clsx";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { controlBaseClasses, useFieldControl } from "./fieldContext";
import { IconButton } from "./IconButton";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name when the Stepper is not inside a Field. */
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Whole-number input with − and + buttons, e.g. for bottle counts. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  label,
  id,
  disabled = false,
  className,
}: StepperProps) {
  const field = useFieldControl();
  const name = label ?? field?.label ?? "value";
  // Text being typed; committed (and clamped) on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    setDraft(null);
    const parsed = Number.parseInt(raw, 10);
    onChange(Number.isNaN(parsed) ? clamp(value, min, max) : clamp(parsed, min, max));
  };

  return (
    <div className={clsx("inline-flex items-center gap-1.5", className)}>
      <IconButton
        label={`Decrease ${name}`}
        variant="secondary"
        icon={<Minus />}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step, min, max))}
      />
      <input
        type="number"
        inputMode="numeric"
        id={id ?? field?.id}
        aria-label={field ? undefined : label}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        min={min}
        max={max === Number.MAX_SAFE_INTEGER ? undefined : max}
        step={step}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
        }}
        className={clsx(controlBaseClasses, "w-16 text-center tabular-nums")}
      />
      <IconButton
        label={`Increase ${name}`}
        variant="secondary"
        icon={<Plus />}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step, min, max))}
      />
    </div>
  );
}
