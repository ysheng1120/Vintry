import { useLiveQuery } from "dexie-react-hooks";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { db } from "../../db/db";
import { mergeWines } from "../../domain/commands";
import { bottles, wineLabel } from "../../domain/labels";
import { normalizeName } from "../../domain/match";
import type { Wine } from "../../domain/types";
import { pluralize } from "../../lib/format";
import { errorMessage, useCommandFeedback } from "../../app/commandFeedback";
import { SheetForm } from "./SheetForm";

export interface MergeSheetProps {
  wine: Wine;
  onClose: () => void;
}

/** How many words of `text`, normalized, must all appear in a wine's producer, name and vintage. */
function matches(wine: Wine, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = normalizeName(`${wine.producer} ${wine.name} ${wine.vintage ?? "nv"}`);
  return words.every((word) => text.includes(word));
}

/** Other wines the collector could merge `wine` into: live, not sample-vs-real mixed. */
function useOtherWines(wine: Wine): Wine[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.wines.toArray();
    // Not isMatchCandidate: that skips every sample wine, but sample wines may merge with each other.
    return all.filter((w) => w.id !== wine.id && !w.deletedAt && w.isSample === wine.isSample);
  }, [wine.id, wine.isSample]);
}

interface MergeCounts {
  bottleCount: number;
  noteCount: number;
  drinkCount: number;
}

/** What moving `wineId`'s records over amounts to, for the confirmation sentence. */
function useMergeCounts(wineId: string | null): MergeCounts | undefined {
  return useLiveQuery(async () => {
    if (!wineId) return undefined;
    const [lots, noteCount, drinkCount] = await Promise.all([
      db.lots.where("wineId").equals(wineId).toArray(),
      db.tastingNotes.where("wineId").equals(wineId).count(),
      db.consumptions.where("wineId").equals(wineId).count(),
    ]);
    const bottleCount = lots.filter((l) => l.quantity > 0).reduce((sum, l) => sum + l.quantity, 0);
    return { bottleCount, noteCount, drinkCount };
  }, [wineId]);
}

/**
 * Merges a duplicate wine into this one: search picks the duplicate, likely matches (same
 * producer and vintage) come first, and the sentence below spells out what moves before the
 * collector confirms (R6: it's one undoable change).
 */
export function MergeSheet({ wine, onClose }: MergeSheetProps) {
  const { done, failed } = useCommandFeedback();
  const others = useOtherWines(wine);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useMemo(() => normalizeName(search).split(" ").filter(Boolean), [search]);
  const likely = useMemo(
    () =>
      (others ?? []).filter(
        (w) =>
          normalizeName(w.producer) === normalizeName(wine.producer) && w.vintage === wine.vintage,
      ),
    [others, wine.producer, wine.vintage],
  );
  const likelyIds = useMemo(() => new Set(likely.map((w) => w.id)), [likely]);
  const rest = useMemo(
    () => (others ?? []).filter((w) => !likelyIds.has(w.id)),
    [others, likelyIds],
  );
  const filteredLikely = likely.filter((w) => matches(w, words));
  const filteredRest = rest.filter((w) => matches(w, words));

  const selected = (others ?? []).find((w) => w.id === selectedId) ?? null;
  const counts = useMergeCounts(selectedId);

  const submit = async () => {
    if (!selectedId) {
      setError("Choose a wine to merge with.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await mergeWines({ keepId: wine.id, mergeId: selectedId });
      done(result);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      failed(e, "Couldn't merge these wines");
      setBusy(false);
    }
  };

  return (
    <SheetForm
      title="Merge with another wine"
      description={wineLabel(wine)}
      submitLabel="Merge wines"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field label="Find the duplicate" hint="Search by producer, wine, or vintage.">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="For example Ridge Monte Bello 2019"
          autoComplete="off"
        />
      </Field>

      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
        {others === undefined ? null : others.length === 0 ? (
          <p className="text-sm text-ink-muted">There's no other wine in your cellar yet.</p>
        ) : filteredLikely.length === 0 && filteredRest.length === 0 ? (
          <p className="text-sm text-ink-muted">No wines match that search.</p>
        ) : (
          <>
            {filteredLikely.length > 0 && (
              <CandidateGroup
                heading="Likely duplicates"
                wines={filteredLikely}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
            {filteredRest.length > 0 && (
              <CandidateGroup
                heading={filteredLikely.length > 0 ? "Other wines" : undefined}
                wines={filteredRest}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </>
        )}
      </div>

      {selected && counts && (
        <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink">
          The {bottles(counts.bottleCount)}, {pluralize(counts.noteCount, "note")} and{" "}
          {pluralize(counts.drinkCount, "drink")} of {wineLabel(selected)} move to this wine.{" "}
          {wineLabel(selected)} is then deleted; you can undo this.
        </p>
      )}
    </SheetForm>
  );
}

function CandidateGroup({
  heading,
  wines,
  selectedId,
  onSelect,
}: {
  heading?: string;
  wines: Wine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {heading && (
        <p className="px-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          {heading}
        </p>
      )}
      {wines.map((w) => {
        const selected = w.id === selectedId;
        return (
          <button
            key={w.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(w.id)}
            className={clsx(
              "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left",
              selected ? "bg-primary-soft text-primary" : "text-ink hover:bg-surface-muted",
            )}
          >
            <span className="truncate font-medium">{wineLabel(w)}</span>
            {selected && <Check aria-hidden="true" className="size-4 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
