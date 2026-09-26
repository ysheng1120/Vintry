import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { resolveProposal, SESSION_ID } from "../../ai/sommelier/loop";
import type { Proposal, ProposalStatus } from "../../ai/sommelier/thread";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { LotDraft, WineDraft } from "../../domain/commands";
import { DraftCard } from "../add/DraftCard";
import type { BottleDraft } from "../add/draft";
import { useCommandFeedback } from "../cellar/feedback";

const STATUS_BADGES: Record<
  Exclude<ProposalStatus, "pending">,
  { label: string; tone: BadgeTone }
> = {
  applied: { label: "Done", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  stale: { label: "Not applied", tone: "warning" },
  failed: { label: "Not applied", tone: "danger" },
};

/** The add proposal's command drafts as DraftCard drafts, so the collector can edit them. */
function toBottleDrafts(input: Proposal["input"]): BottleDraft[] {
  const drafts = (input.drafts ?? []) as (WineDraft & { lots: LotDraft[] })[];
  return drafts.map((draft) => ({
    wineId: draft.wineId ?? null,
    producer: draft.producer,
    name: draft.name ?? null,
    vintage: draft.vintage,
    colour: draft.colour,
    country: draft.country ?? null,
    region: draft.region ?? null,
    appellation: draft.appellation ?? null,
    grapes: draft.grapes ?? null,
    bottleSize: draft.bottleSize ?? null,
    windowFrom: draft.windowFrom ?? null,
    windowTo: draft.windowTo ?? null,
    windowSource: draft.windowFrom != null || draft.windowTo != null ? "ai" : null,
    windowNote: draft.windowNote ?? null,
    wineNotes: draft.notes ?? null,
    lots: draft.lots.map((lot) => ({
      quantity: lot.quantity,
      locationId: lot.locationId ?? null,
      bin: lot.bin ?? null,
      purchaseDate: lot.purchaseDate ?? null,
      pricePerBottle: lot.pricePerBottle ?? null,
      currency: lot.currency ?? null,
      store: lot.store ?? null,
    })),
    notes: ["Suggested by the sommelier. Check the details before you add them."],
  }));
}

export interface ProposalCardProps {
  threadId: string;
  toolUseId: string;
  proposal: Proposal;
}

/**
 * A change the sommelier proposes (R15). Nothing is written until the collector confirms.
 * Cards left from an earlier session show as expired and cannot be confirmed.
 */
export function ProposalCard({ threadId, toolUseId, proposal }: ProposalCardProps) {
  const titleId = useId();
  const { done, failed } = useCommandFeedback();
  const [working, setWorking] = useState<"confirm" | "decline" | null>(null);
  const status: ProposalStatus =
    proposal.status === "pending" && proposal.sessionId !== SESSION_ID
      ? "expired"
      : proposal.status;
  const waiting = status === "pending";

  const answer = async (confirm: boolean) => {
    setWorking(confirm ? "confirm" : "decline");
    try {
      const outcome = await resolveProposal(threadId, toolUseId, { confirm });
      if (outcome.result) done(outcome.result);
      else if (confirm && outcome.message) failed(new Error(outcome.message), "Not applied");
    } catch (error) {
      failed(error);
    } finally {
      setWorking(null);
    }
  };

  const saveDrafts = async (drafts: WineDraft[]) => {
    const outcome = await resolveProposal(threadId, toolUseId, { confirm: true, drafts });
    if (!outcome.result) throw new Error(outcome.message ?? "The bottles were not added.");
    return outcome.result;
  };

  return (
    <Card role="group" aria-labelledby={titleId} padding="md" className="border-accent/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-ink uppercase">
            Proposed change
          </p>
          <h3 id={titleId} className="mt-1 font-semibold text-ink">
            {proposal.title}
          </h3>
        </div>
        {status !== "pending" && (
          <Badge tone={STATUS_BADGES[status].tone}>{STATUS_BADGES[status].label}</Badge>
        )}
      </div>

      {waiting && proposal.kind === "add" ? (
        <div className="mt-4">
          <DraftCard
            drafts={toBottleDrafts(proposal.input)}
            source="ai-chat"
            save={saveDrafts}
            onSaved={(result) => done(result)}
            onCancel={() => void answer(false)}
          />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {proposal.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {status === "expired" && (
        <p className="mt-3 text-sm text-ink">This proposal expired and was not applied.</p>
      )}
      {(status === "applied" || status === "stale" || status === "failed") && proposal.outcome && (
        <p className="mt-3 text-sm text-ink">{proposal.outcome}</p>
      )}
      {status === "applied" && proposal.wineId && (
        <Link
          to={`/wine/${encodeURIComponent(proposal.wineId)}`}
          className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Open the wine
        </Link>
      )}

      {waiting && proposal.kind !== "add" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Check aria-hidden="true" className="size-4" />}
            loading={working === "confirm"}
            disabled={working !== null}
            onClick={() => void answer(true)}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X aria-hidden="true" className="size-4" />}
            loading={working === "decline"}
            disabled={working !== null}
            onClick={() => void answer(false)}
          >
            Not now
          </Button>
        </div>
      )}
    </Card>
  );
}
