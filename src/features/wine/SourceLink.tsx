import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { isHttpUrl } from "../../ai/features/webResearch";
import type { CriticSource } from "../../domain/types";

const LINK_CLASS =
  "inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline";

/**
 * A link to a source page, in a new tab. Anything but an http(s) URL renders `fallback` instead
 * (nothing by default), so a stored link can never run script.
 */
export function SourceLink({
  source,
  label,
  name,
  fallback = null,
}: {
  source: CriticSource;
  label: string;
  /** Accessible name, e.g. "Source 1: Decanter review". */
  name: string;
  fallback?: ReactNode;
}) {
  if (!isHttpUrl(source.url)) return fallback;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title}
      aria-label={`${name} (opens in a new tab)`}
      className={LINK_CLASS}
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}
