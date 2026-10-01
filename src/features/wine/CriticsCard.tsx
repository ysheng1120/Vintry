import { ExternalLink, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  generateWineCritics,
  isHttpUrl,
  NO_REVIEWS_MESSAGE,
} from "../../ai/features/criticsConsensus";
import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { useCommandFeedback } from "../../app/commandFeedback";
import { Button } from "../../components/ui/Button";
import { setWineCritics } from "../../domain/commands";
import type { CriticSource, Wine } from "../../domain/types";
import { formatDate } from "../../lib/format";

export interface CriticsSectionProps {
  wine: Wine;
}

const LINK_CLASS =
  "inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline";

/** A link to a source page, in a new tab. Anything but an http(s) URL renders nothing. */
function SourceLink({
  source,
  label,
  name,
}: {
  source: CriticSource;
  label: string;
  /** Accessible name, e.g. "Source 1: Decanter review". */
  name: string;
}) {
  if (!isHttpUrl(source.url)) return null;
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

/**
 * The "What critics say" section of the About this wine card: on request, Claude searches reputable wine sites for this wine and the
 * app shows a short, sourced summary. Scores are shown only when the text cited from their
 * source shows them (checked in criticsConsensus.ts). Finding, refreshing, and removing it are
 * undoable commands (KTD4); only the wine's identity is sent. The card shows the AI status note
 * once; buttons carry it as a title.
 */
export default function CriticsSection({ wine }: CriticsSectionProps) {
  const status = useAiStatus();
  const { done, failed } = useCommandFeedback();
  const [finding, setFinding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Set synchronously, so a double click cannot start a second request before React re-renders.
  const runningRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const find = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setFinding(true);
    try {
      const result = await generateWineCritics(wine, { signal: controller.signal });
      if (!controller.signal.aborted) done(result);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't find what critics say");
    } finally {
      runningRef.current = false;
      if (!controller.signal.aborted) setFinding(false);
    }
  };

  const remove = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRemoving(true);
    try {
      done(await setWineCritics({ wineId: wine.id, critics: null }));
    } catch (error) {
      failed(error, "Couldn't remove what critics say");
    } finally {
      runningRef.current = false;
      setRemoving(false);
    }
  };

  const critics = wine.critics;
  const note = aiStatusNote(status);
  const busy = finding || removing;
  const disabled = status.state !== "ready" || busy;

  // Only sources that can be linked are numbered, in order of first appearance.
  const numbers = new Map<string, number>();
  for (const point of critics?.points ?? []) {
    for (const source of point.sources) {
      if (isHttpUrl(source.url) && !numbers.has(source.url)) {
        numbers.set(source.url, numbers.size + 1);
      }
    }
  }

  return (
    <section>
      <h3 className="mb-1 text-base font-semibold">What critics say</h3>
      {!critics ? (
        <>
          <p className="text-sm text-ink-muted">
            Searches reputable wine sites. Uses your AI key (a few web searches).
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Search aria-hidden="true" className="size-4" />}
              loading={finding}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void find()}
            >
              {finding ? "Searching…" : "Find what critics say"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {!critics.found ? (
            <p className="text-ink-muted">{NO_REVIEWS_MESSAGE}</p>
          ) : (
            <>
              {critics.consensus && <p className="text-ink-muted">{critics.consensus}</p>}
              {critics.scores.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-ink">Scores</h4>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-ink-muted">
                    {critics.scores.map((score, index) => (
                      <li key={`${score.critic}-${score.publication}-${index}`}>
                        {score.critic || score.publication}: {score.score}/{score.scale}
                        {score.critic && score.publication && ` (${score.publication})`}{" "}
                        <SourceLink
                          source={score.source}
                          label="Source"
                          name={`Source: ${score.source.title}`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {critics.points.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink-muted">
                  {critics.points.map((point, index) => (
                    <li key={`${index}-${point.text}`}>
                      {point.text}
                      {point.sources.map((source) =>
                        numbers.has(source.url) ? (
                          <span key={source.url}>
                            {" "}
                            <SourceLink
                              source={source}
                              label={`[${numbers.get(source.url)}]`}
                              name={`Source ${numbers.get(source.url)}: ${source.title}`}
                            />
                          </span>
                        ) : null,
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="text-xs text-ink-subtle">
            Researched by AI on {formatDate(critics.generatedAt)}. Scores are shown only when the
            source shows them. Check the linked reviews.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label="Refresh critics summary"
              variant="ghost"
              size="sm"
              loading={finding}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void find()}
            >
              Refresh
            </Button>
            <Button
              aria-label="Remove critics summary"
              variant="ghost"
              size="sm"
              loading={removing}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
