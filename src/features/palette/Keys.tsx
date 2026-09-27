import { Fragment } from "react";

const SPOKEN: Record<string, string> = { "⌘": "Command" };

/** Keys pressed together, each in its own key cap; ⌘ is also spelled out for screen readers. */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <Fragment key={key}>
          <kbd className="inline-flex min-w-7 justify-center rounded-md border border-border-strong bg-surface-muted px-1.5 py-0.5 font-sans text-sm font-semibold text-ink">
            {SPOKEN[key] ? (
              <>
                <span aria-hidden="true">{key}</span>
                <span className="sr-only">{SPOKEN[key]}</span>
              </>
            ) : (
              key
            )}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
