import clsx from "clsx";
import { KeyRound, WifiOff } from "lucide-react";
import { Link } from "react-router";
import { buttonClasses } from "../components/ui/buttonStyles";
import type { AiStatus } from "./useAiStatus";

export interface AiStatusNoticeProps {
  status: AiStatus;
  /** The way to do the same thing without AI, e.g. { to: "/add/manual", label: "Add by hand" }. */
  manual?: { to: string; label: string };
  className?: string;
}

/**
 * The no-key and unavailable states every AI entry point shows (R18). Renders nothing when
 * AI is ready, so an entry point can render it unconditionally above its AI controls.
 */
export function AiStatusNotice({ status, manual, className }: AiStatusNoticeProps) {
  if (status.state === "ready") return null;
  const noKey = status.state === "no-key";
  const Icon = noKey ? KeyRound : WifiOff;
  return (
    <div
      className={clsx(
        "flex flex-col gap-3 rounded-2xl border border-border bg-surface-muted p-4 sm:flex-row sm:items-start",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">
          {noKey ? "AI needs your Claude API key" : "AI is unavailable right now"}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {noKey
            ? "Add a key to use this. You pay Anthropic only for what you use; Settings shows the cost."
            : status.reason}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {noKey && (
            <>
              <Link to="/settings" className={buttonClasses({ variant: "primary", size: "sm" })}>
                Add a key in Settings
              </Link>
              <Link to="/help#ai-key" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                How to get a key
              </Link>
            </>
          )}
          {manual && (
            <Link to={manual.to} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              {manual.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
