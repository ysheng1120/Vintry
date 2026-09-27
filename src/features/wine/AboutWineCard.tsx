import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateWineProfile } from "../../ai/features/wineProfile";
import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { setWineProfile } from "../../domain/commands";
import type { Wine } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { useCommandFeedback } from "../../app/commandFeedback";

export interface AboutWineCardProps {
  wine: Wine;
}

/**
 * "About this wine": a short AI-written profile (style, typical tasting notes, food pairings,
 * serving tips) from the wine's identity alone, shown on the wine page. Writing, rewriting and
 * removing it are all undoable commands (KTD4); nothing here reads this bottle's price, notes,
 * or location.
 */
export default function AboutWineCard({ wine }: AboutWineCardProps) {
  const status = useAiStatus();
  const { done, failed } = useCommandFeedback();
  const [writing, setWriting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const write = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setWriting(true);
    try {
      const result = await generateWineProfile(wine, { signal: controller.signal });
      if (!controller.signal.aborted) done(result);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't write a profile");
    } finally {
      if (!controller.signal.aborted) setWriting(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      done(await setWineProfile({ wineId: wine.id, profile: null }));
    } catch (error) {
      failed(error, "Couldn't remove the profile");
    } finally {
      setRemoving(false);
    }
  };

  const profile = wine.profile;
  const note = aiStatusNote(status);
  const busy = writing || removing;
  const disabled = status.state !== "ready" || busy;

  return (
    <Card padding="lg">
      <h2 className="mb-2 text-lg font-semibold">About this wine</h2>
      {!profile ? (
        <>
          <p className="text-sm text-ink-muted">
            Ask Claude for a short profile: its style, typical tasting notes, food pairings, and
            serving tips.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Sparkles aria-hidden="true" className="size-4" />}
              loading={writing}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void write()}
            >
              {writing ? "Writing…" : "Write a profile"}
            </Button>
            {note && <span className="text-xs text-ink-muted">{note}</span>}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-muted">{profile.summary}</p>
          {profile.tasting && <p className="text-ink-muted">{profile.tasting}</p>}
          {profile.pairings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">Pairs well with</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
                {profile.pairings.map((pairing) => (
                  <li key={pairing}>{pairing}</li>
                ))}
              </ul>
            </div>
          )}
          {profile.serving && <p className="text-sm text-ink-muted">{profile.serving}</p>}
          <p className="text-xs text-ink-subtle">
            Written by AI on {formatDate(profile.generatedAt)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={writing}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void write()}
            >
              Rewrite
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={removing}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
            {note && <span className="text-xs text-ink-muted">{note}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
