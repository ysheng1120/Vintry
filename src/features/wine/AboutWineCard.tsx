import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { generateWineProfile } from "../../ai/features/wineProfile";
import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { setWineProfile } from "../../domain/commands";
import type { Wine } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { useCommandFeedback } from "../../app/commandFeedback";

export interface ProfileSectionProps {
  wine: Wine;
}

/**
 * The "Profile" section of the About this wine card: a short AI-written profile (style, typical
 * tasting notes, food pairings, serving tips) from the wine's identity alone. Writing, rewriting
 * and removing it are all undoable commands (KTD4); nothing here reads this bottle's price,
 * notes, or location. The card shows the AI status note once; buttons carry it as a title.
 */
export default function ProfileSection({ wine }: ProfileSectionProps) {
  const status = useAiStatus();
  const { done, failed } = useCommandFeedback();
  const [writing, setWriting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Set synchronously, so a double click cannot start a second request before React re-renders.
  const runningRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const write = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setWriting(true);
    try {
      const result = await generateWineProfile(wine, { signal: controller.signal });
      if (!controller.signal.aborted) done(result);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't write a profile");
    } finally {
      runningRef.current = false;
      if (!controller.signal.aborted) setWriting(false);
    }
  };

  const remove = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRemoving(true);
    try {
      done(await setWineProfile({ wineId: wine.id, profile: null }));
    } catch (error) {
      failed(error, "Couldn't remove the profile");
    } finally {
      runningRef.current = false;
      setRemoving(false);
    }
  };

  const profile = wine.profile;
  const note = aiStatusNote(status);
  const busy = writing || removing;
  const disabled = status.state !== "ready" || busy;

  return (
    <section>
      <h3 className="mb-1 text-base font-semibold">Profile</h3>
      {!profile ? (
        <>
          <p className="text-sm text-ink-muted">
            Style, typical tasting notes, food pairings, and serving tips.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
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
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-muted">{profile.summary}</p>
          {profile.tasting && <p className="text-ink-muted">{profile.tasting}</p>}
          {profile.pairings.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-ink">Pairs well with</h4>
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
              aria-label="Rewrite profile"
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
              aria-label="Remove profile"
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
