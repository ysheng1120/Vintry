import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { AiStatusNotice } from "../../ai/AiStatusNotice";
import { describeBottles } from "../../ai/features/describe";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { Textarea } from "../../components/ui/Textarea";
import type { CommandResult } from "../../domain/commands";
import { errorMessage, useCommandFeedback } from "../../app/commandFeedback";
import { DraftCard } from "./DraftCard";
import type { BottleDraft } from "./draft";

const MANUAL = { to: "/add/manual", label: "Add by hand" };

const NOTHING_FOUND =
  "Couldn't find a wine in that. Try naming the producer or wine, the vintage, and how many bottles.";

// The Web Speech API is not in TypeScript's DOM types; this is the small part used here.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Describe in words (R12): one typed or spoken sentence becomes one or more editable drafts on
 * one DraftCard (source "ai-describe"). Without a key it offers the manual path (R18).
 */
export default function DescribePage() {
  const navigate = useNavigate();
  const status = useAiStatus();
  const { done } = useCommandFeedback();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<BottleDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) {
      setError("Write a sentence about the bottles first.");
      return;
    }
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const result = await describeBottles(text, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.length === 0) setError(NOTHING_FOUND);
      else setDrafts(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const onSaved = (result: CommandResult) => {
    done(result, { onUndone: () => void navigate("/add/describe") });
    const ids = result.touched.wineIds;
    void navigate(ids.length === 1 ? `/wine/${ids[0]}` : "/cellar");
  };

  let body;
  if (drafts) {
    body = (
      <DraftCard
        drafts={drafts}
        source="ai-describe"
        onSaved={onSaved}
        onCancel={() => setDrafts(null)}
      />
    );
  } else if (status.state !== "ready") {
    body = <AiStatusNotice status={status} manual={MANUAL} />;
  } else {
    body = (
      <Card padding="lg">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
          <Field
            label="What did you buy?"
            hint="For example: “bought 6 bottles of 2019 Ridge Monte Bello at $250 each from K&L”."
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus />
          </Field>
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-ink">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy}>
              {busy ? "Making a draft…" : "Make a draft"}
            </Button>
            <SpeakButton
              disabled={busy}
              onText={(heard) =>
                setText((current) => (current.trim() ? `${current.trim()} ${heard}` : heard))
              }
            />
          </div>
        </form>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Describe it"
        subtitle="Say what you bought in one sentence. You check the draft before anything is saved."
        back={{ to: "/add", label: "Add wine" }}
      />
      {body}
    </>
  );
}

/** Dictation through the browser's own speech service, shown only where the browser has one. */
function SpeakButton({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });
  useEffect(() => () => recognitionRef.current?.abort(), []);

  const Recognition = speechRecognition();
  if (!Recognition) return null;

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-GB";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const heard = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (heard) onTextRef.current(heard);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        aria-pressed={listening}
        icon={
          listening ? (
            <MicOff aria-hidden="true" className="size-4" />
          ) : (
            <Mic aria-hidden="true" className="size-4" />
          )
        }
        onClick={toggle}
      >
        {listening ? "Stop" : "Speak"}
      </Button>
      <p className="basis-full text-xs text-ink-muted">
        Speaking uses your browser's speech service, which may send the audio to its provider.
      </p>
    </>
  );
}
