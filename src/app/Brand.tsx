import clsx from "clsx";

/** The Vintry glass mark (matches public/icon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary shadow-card",
        className ?? "size-9",
      )}
    >
      <svg viewBox="0 0 512 512" className="size-[70%]" fill="none">
        <path
          d="M168 96H344C352 212 318 276 256 288C194 276 160 212 168 96Z"
          stroke="currentColor"
          strokeWidth="30"
          strokeLinejoin="round"
        />
        <path
          d="M178 186H334C326 244 298 276 256 284C214 276 186 244 178 186Z"
          fill="currentColor"
        />
        <path
          d="M256 288V404M188 412H324"
          stroke="currentColor"
          strokeWidth="30"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("font-display font-semibold tracking-tight text-ink", className)}>
      Vintry
    </span>
  );
}
