import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Info, MessageCircle, Search, Send, Square } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AiStatusNotice } from "../../ai/AiStatusNotice";
import { askInNewThread, expireStaleProposals, sendUserMessage } from "../../ai/sommelier/loop";
import { stopRun, useRunState } from "../../ai/sommelier/runState";
import { getThread, listMessages } from "../../ai/sommelier/thread";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { db } from "../../db/db";
import { wineLabel } from "../../domain/labels";
import { useCommandFeedback } from "../cellar/feedback";
import { BottleCards } from "./BottleCards";
import { ProposalCard } from "./ProposalCard";
import { ThreadList } from "./ThreadList";
import { toTranscript, type TranscriptItem } from "./transcript";

const SUGGESTED_PROMPTS = [
  "What should I open tonight?",
  "What is past its peak?",
  "Pair with roast lamb",
];

const WINE_PROMPTS = [
  "When should I drink this?",
  "What food goes with it?",
  "Is there something similar in my cellar?",
];

const PRIVACY_NOTE =
  "The sommelier sends details of your cellar to Anthropic to answer. Nothing changes until you confirm a card.";

/** The wine from `?wine=<id>` (from "Ask sommelier" on a wine page), when it exists. */
function useScreenWine() {
  const [params] = useSearchParams();
  const wineId = params.get("wine");
  const wine = useLiveQuery(
    async () => (wineId ? ((await db.wines.get(wineId)) ?? null) : null),
    [wineId],
  );
  return { wine: wine && !wine.deletedAt ? wine : null };
}

const ASK_PREFILL_MAX = 500;

/**
 * The text from `?ask=<text>` (e.g. a shortcut or an external link into the sommelier), trimmed
 * and capped at 500 characters. Read once on mount, then the param is dropped from the URL (with
 * `replace`) so going Back never refills it. It only fills the composer; the user still presses
 * Send.
 */
function useAskPrefill(): string {
  const [params, setParams] = useSearchParams();
  const [ask] = useState(() => (params.get("ask") ?? "").trim().slice(0, ASK_PREFILL_MAX));

  useEffect(() => {
    if (!params.has("ask")) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("ask");
        return next;
      },
      { replace: true },
    );
    // Reads and clears the param once, right after the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ask;
}

function threadPath(threadId: string, wineId: string | null): string {
  const base = `/sommelier/${encodeURIComponent(threadId)}`;
  return wineId ? `${base}?wine=${encodeURIComponent(wineId)}` : base;
}

function ChatLayout({
  currentThreadId,
  children,
}: {
  currentThreadId: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="order-last lg:order-first">
        <ThreadList currentThreadId={currentThreadId} />
      </aside>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

/** The sommelier home: a new, empty conversation with suggested questions (R14). */
export default function SommelierHome() {
  const navigate = useNavigate();
  const status = useAiStatus();
  const { failed } = useCommandFeedback();
  const { wine } = useScreenWine();
  const askPrefill = useAskPrefill();

  const start = async (text: string) => {
    const screen = { wineId: wine?.id ?? null };
    const { threadId, done } = await askInNewThread(text, { screen });
    done.catch((error: unknown) => failed(error, "The message was not sent"));
    await navigate(threadPath(threadId, wine?.id ?? null));
  };

  return (
    <>
      <PageHeader
        title="Sommelier"
        subtitle="Ask about your own bottles: what to open tonight, what goes with lamb."
      />
      <ChatLayout currentThreadId={null}>
        <AiStatusNotice status={status} manual={{ to: "/cellar", label: "Browse the cellar" }} />
        {wine && <ScreenNote label={wineLabel(wine)} />}
        {status.state === "ready" && (
          <>
            <SuggestedPrompts
              prompts={wine ? WINE_PROMPTS : SUGGESTED_PROMPTS}
              onPick={(prompt) => void start(prompt)}
            />
            <Composer busy={false} onSend={start} initialText={askPrefill} />
          </>
        )}
        <p className="text-sm text-ink-subtle">{PRIVACY_NOTE}</p>
      </ChatLayout>
    </>
  );
}

/** One conversation at /sommelier/:threadId. */
export function ThreadPage() {
  const { threadId = "" } = useParams();
  const status = useAiStatus();
  const { failed } = useCommandFeedback();
  const { wine } = useScreenWine();
  const run = useRunState(threadId);
  const thread = useLiveQuery(async () => (await getThread(threadId)) ?? null, [threadId]);
  const rows = useLiveQuery(() => listMessages(threadId), [threadId]);

  // Cards left from an earlier session expire when the thread is opened (R15).
  useEffect(() => {
    if (threadId) void expireStaleProposals(threadId);
  }, [threadId]);

  const send = async (text: string) => {
    try {
      await sendUserMessage(threadId, text, { screen: { wineId: wine?.id ?? null } });
    } catch (error) {
      failed(error, "The message was not sent");
    }
  };

  const header = (
    <PageHeader
      title="Conversation"
      subtitle={thread?.title || undefined}
      back={{ to: "/sommelier", label: "Sommelier" }}
    />
  );

  if (thread === null) {
    return (
      <>
        {header}
        <EmptyState
          icon={<MessageCircle />}
          title="This conversation isn't here"
          description="It may have been removed, for example by restoring a backup."
          action={
            <Link to="/sommelier" className={buttonClasses({ variant: "primary" })}>
              Start a new chat
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ChatLayout currentThreadId={threadId}>
        {wine && <ScreenNote label={wineLabel(wine)} />}
        {rows === undefined ? (
          <SkeletonText lines={4} />
        ) : (
          <Transcript
            threadId={threadId}
            items={toTranscript(rows)}
            streamText={run.streamText}
            busy={run.busy}
          />
        )}
        <AiStatusNotice status={status} manual={{ to: "/cellar", label: "Browse the cellar" }} />
        {status.state === "ready" && (
          <Composer busy={run.busy} onSend={send} onStop={() => stopRun(threadId)} />
        )}
        <p className="text-sm text-ink-subtle">{PRIVACY_NOTE}</p>
      </ChatLayout>
    </>
  );
}

function ScreenNote({ label }: { label: string }) {
  return (
    <p className="rounded-xl bg-accent-soft px-4 py-2 text-sm text-accent-ink">
      Asking about {label}
    </p>
  );
}

function SuggestedPrompts({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (prompt: string) => void;
}) {
  return (
    <section aria-label="Suggested questions" className="flex flex-col gap-3">
      <p className="text-ink-muted">Try one of these, or ask your own question.</p>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <Button key={prompt} variant="secondary" onClick={() => onPick(prompt)}>
            {prompt}
          </Button>
        ))}
      </div>
    </section>
  );
}

function Transcript({
  threadId,
  items,
  streamText,
  busy,
}: {
  threadId: string;
  items: TranscriptItem[];
  streamText: string;
  busy: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items.length, streamText]);

  return (
    <div role="log" aria-label="Conversation" aria-busy={busy} className="flex flex-col gap-4">
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 whitespace-pre-line text-on-primary">
                {item.text}
              </p>
            </div>
          );
        }
        if (item.kind === "notice") {
          const Icon = item.tone === "error" ? AlertTriangle : Info;
          return (
            <p
              key={item.id}
              role={item.tone === "error" ? "alert" : undefined}
              className={clsx(
                "flex items-start gap-2 rounded-xl px-4 py-2 text-sm",
                item.tone === "error"
                  ? "bg-danger-soft text-danger"
                  : "bg-surface-muted text-ink-muted",
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {item.text}
            </p>
          );
        }
        return (
          <div key={item.id} className="flex max-w-full flex-col gap-3">
            {item.chips.length > 0 && (
              <ul aria-label="Steps" className="flex flex-wrap gap-2">
                {item.chips.map((chip, index) => (
                  <li
                    key={`${chip}-${index}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-xs text-ink-muted"
                  >
                    <Search aria-hidden="true" className="size-3" />
                    {chip}
                  </li>
                ))}
              </ul>
            )}
            {item.text && <AssistantText text={item.text} />}
            {item.wineIds.length > 0 && <BottleCards wineIds={item.wineIds} />}
            {item.proposals.map(({ toolUseId, proposal }) => (
              <ProposalCard
                key={toolUseId}
                threadId={threadId}
                toolUseId={toolUseId}
                proposal={proposal}
              />
            ))}
          </div>
        );
      })}
      {busy && (
        <div aria-live="polite">
          {streamText ? (
            <AssistantText text={streamText} />
          ) : (
            <p className="text-sm text-ink-muted">The sommelier is thinking…</p>
          )}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-2.5 whitespace-pre-line text-ink">
      {text}
    </div>
  );
}

function Composer({
  busy,
  onSend,
  onStop,
  initialText = "",
}: {
  busy: boolean;
  onSend: (text: string) => Promise<void>;
  onStop?: () => void;
  /** Fills the box on mount and focuses it (from `?ask=`); never sends on its own. */
  initialText?: string;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !busy && !sending;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText) textareaRef.current?.focus();
    // Only on mount: a prefilled composer is focused once, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const question = text;
    setSending(true);
    setText("");
    try {
      await onSend(question);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) void submit(event);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Ask the sommelier
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What should I open with roast chicken?"
          className="min-h-12 flex-1 resize-y rounded-xl border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        {busy && onStop ? (
          <Button
            variant="secondary"
            icon={<Square aria-hidden="true" className="size-4" />}
            onClick={onStop}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!canSend}
            loading={sending}
            icon={<Send aria-hidden="true" className="size-4" />}
          >
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
