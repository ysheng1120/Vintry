import clsx from "clsx";
import { Camera, ImageUp, ScanText } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { AiStatusNotice } from "../../ai/AiStatusNotice";
import { scanLabel } from "../../ai/features/scanLabel";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import type { CommandResult } from "../../domain/commands";
import { prepareLabelImage, type PreparedImage } from "../../lib/image";
import { errorMessage, useCommandFeedback } from "../cellar/feedback";
import { DraftCard } from "./DraftCard";
import type { BottleDraft } from "./draft";

const MANUAL = { to: "/add/manual", label: "Add by hand" };

type Phase =
  | { kind: "pick" }
  | { kind: "preview"; image: PreparedImage }
  | { kind: "reading"; image: PreparedImage }
  | { kind: "draft"; draft: BottleDraft };

const hasCameraApi = () =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

/**
 * Label scan (R11): choose, drop, or take a photo; Claude reads it into an editable draft that
 * saves through the DraftCard (source "ai-scan"). Without a key it offers the manual path (R18).
 */
export default function ScanPage() {
  const navigate = useNavigate();
  const status = useAiStatus();
  const { done } = useCommandFeedback();
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<"closed" | "open" | "unavailable">(() =>
    hasCameraApi() ? "closed" : "unavailable",
  );
  const readRef = useRef<AbortController | null>(null);

  // A scan still running when the page closes is cancelled.
  useEffect(() => () => readRef.current?.abort(), []);

  const takePhoto = async (source: Blob | HTMLVideoElement) => {
    setError(null);
    try {
      setPhase({ kind: "preview", image: await prepareLabelImage(source) });
    } catch (e) {
      setError(errorMessage(e));
      setPhase({ kind: "pick" });
    } finally {
      // Closing the camera stops it, so this waits until the frame has been read.
      setCamera((c) => (c === "open" ? "closed" : c));
    }
  };

  const read = async (image: PreparedImage) => {
    setError(null);
    setPhase({ kind: "reading", image });
    const controller = new AbortController();
    readRef.current = controller;
    try {
      const draft = await scanLabel(image, { signal: controller.signal });
      if (!controller.signal.aborted) setPhase({ kind: "draft", draft });
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(errorMessage(e));
      setPhase({ kind: "preview", image });
    }
  };

  const onSaved = (result: CommandResult) => {
    done(result, { onUndone: () => void navigate("/add/scan") });
    const [wineId] = result.touched.wineIds;
    void navigate(wineId ? `/wine/${wineId}` : "/cellar");
  };

  let body;
  if (phase.kind === "draft") {
    body = (
      <DraftCard
        drafts={[phase.draft]}
        source="ai-scan"
        onSaved={onSaved}
        onCancel={() => setPhase({ kind: "pick" })}
      />
    );
  } else if (status.state !== "ready") {
    body = <AiStatusNotice status={status} manual={MANUAL} />;
  } else {
    const image = phase.kind === "pick" ? null : phase.image;
    body = (
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}
        {camera === "open" ? (
          <CameraCapture
            onCapture={(video) => void takePhoto(video)}
            onCancel={() => setCamera("closed")}
            onUnavailable={() => setCamera("unavailable")}
          />
        ) : image ? (
          <Preview
            image={image}
            reading={phase.kind === "reading"}
            onRead={() => void read(image)}
            onChooseAnother={() => {
              setError(null);
              setPhase({ kind: "pick" });
            }}
          />
        ) : (
          <DropZone
            onFile={(file) => void takePhoto(file)}
            cameraState={camera}
            onOpenCamera={() => setCamera("open")}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Scan a label"
        subtitle="Vintry reads the label into a draft you can check. Prices and scores are never guessed."
        back={{ to: "/add", label: "Add wine" }}
      />
      {body}
    </>
  );
}

function DropZone({
  onFile,
  cameraState,
  onOpenCamera,
}: {
  onFile: (file: File) => void;
  cameraState: "closed" | "open" | "unavailable";
  onOpenCamera: () => void;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={clsx(
        "flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        over ? "border-primary bg-primary-soft" : "border-border-strong bg-surface",
      )}
    >
      <ScanText aria-hidden="true" className="size-10 text-ink-subtle" />
      <div>
        <p className="font-medium text-ink">Drop a photo of the front label here</p>
        <p className="mt-1 text-sm text-ink-muted">
          A sharp, well-lit photo of the whole label works best.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <label
          className={buttonClasses({
            variant: "primary",
            className:
              "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
          })}
        >
          <ImageUp aria-hidden="true" className="size-4" />
          Choose photo
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onFile(file);
            }}
          />
        </label>
        {cameraState === "closed" && (
          <Button
            variant="secondary"
            icon={<Camera aria-hidden="true" className="size-4" />}
            onClick={onOpenCamera}
          >
            Use camera
          </Button>
        )}
      </div>
      {cameraState === "unavailable" && hasCameraApi() && (
        <p className="text-sm text-ink-muted">
          The camera isn't available here, so choose a photo instead.
        </p>
      )}
    </div>
  );
}

function Preview({
  image,
  reading,
  onRead,
  onChooseAnother,
}: {
  image: PreparedImage;
  reading: boolean;
  onRead: () => void;
  onChooseAnother: () => void;
}) {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-4">
      <img
        src={`data:${image.mediaType};base64,${image.base64}`}
        alt="Label photo to read"
        className="max-h-80 w-auto rounded-xl border border-border object-contain"
      />
      <div className="flex flex-wrap justify-center gap-2">
        <Button loading={reading} onClick={onRead}>
          {reading ? "Reading the label…" : "Read label"}
        </Button>
        <Button variant="secondary" disabled={reading} onClick={onChooseAnother}>
          Choose another photo
        </Button>
      </div>
    </Card>
  );
}

/** Live camera preview with a shutter. Reports when no camera can be used. */
function CameraCapture({
  onCapture,
  onCancel,
  onUnavailable,
}: {
  onCapture: (video: HTMLVideoElement) => void;
  onCancel: () => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    unavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((media) => {
        stream = media;
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        void video.play().catch(() => {});
      })
      .catch(() => {
        if (!stopped) unavailableRef.current();
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <Card padding="lg" className="flex flex-col items-center gap-4">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera preview"
        onLoadedData={() => setReady(true)}
        className="max-h-80 w-full rounded-xl bg-surface-muted object-contain"
      />
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          disabled={!ready}
          icon={<Camera aria-hidden="true" className="size-4" />}
          onClick={() => {
            if (videoRef.current) onCapture(videoRef.current);
          }}
        >
          Take photo
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
