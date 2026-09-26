import clsx from "clsx";
import { Star } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";

export interface StarRatingProps {
  /** Stored rating 0–100; null means not rated. Shown as 0–5 stars in half steps. */
  value: number | null;
  /** When given, the rating is editable (a keyboard-operable slider). */
  onChange?: (value: number | null) => void;
  /** Accessible name for the editable slider. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** 0–100 to stars rounded to the nearest half. */
function toStars(value: number | null): number {
  if (value == null) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) / 10) / 2;
}

function starsText(stars: number): string {
  return `${stars} out of 5 stars`;
}

export function StarRating({
  value,
  onChange,
  label = "Rating",
  size = "md",
  className,
}: StarRatingProps) {
  const stars = toStars(value);
  const iconSize = size === "md" ? "size-6" : "size-4";

  const icons = [1, 2, 3, 4, 5].map((n) => {
    const fill = stars >= n ? 100 : stars >= n - 0.5 ? 50 : 0;
    return (
      <span
        key={n}
        data-star={n}
        className={clsx("relative inline-block", onChange && "cursor-pointer p-0.5")}
        onClick={
          onChange
            ? (event: MouseEvent<HTMLSpanElement>) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const leftHalf = rect.width > 0 && event.clientX - rect.left < rect.width / 2;
                onChange((leftHalf ? n - 0.5 : n) * 20);
              }
            : undefined
        }
      >
        <Star
          aria-hidden="true"
          className={clsx(iconSize, "text-border-strong")}
          strokeWidth={1.5}
        />
        <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill}%` }}>
          <Star
            aria-hidden="true"
            className={clsx(iconSize, "text-accent", onChange && "m-0.5")}
            fill="currentColor"
            strokeWidth={1.5}
          />
        </span>
      </span>
    );
  });

  if (!onChange) {
    return (
      <span
        role="img"
        aria-label={value == null ? "Not rated" : `Rated ${stars} out of 5`}
        className={clsx("inline-flex items-center", className)}
      >
        {icons}
      </span>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = value ?? 0;
    let next: number | null | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + 10;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - 10;
    else if (event.key === "PageUp") next = current + 20;
    else if (event.key === "PageDown") next = current - 20;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 100;
    else if (/^[0-5]$/.test(event.key)) next = Number(event.key) * 20;
    else if (event.key === "Backspace" || event.key === "Delete") next = null;
    if (next === undefined) return;
    event.preventDefault();
    onChange(next === null ? null : Math.min(100, Math.max(0, next)));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={stars}
      aria-valuetext={value == null ? "Not rated" : starsText(stars)}
      onKeyDown={onKeyDown}
      className={clsx(
        "inline-flex min-h-10 items-center rounded-xl px-1 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {icons}
    </div>
  );
}
