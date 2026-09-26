import clsx from "clsx";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { placePopover, type Box } from "./placement";
import type { TourStep } from "./steps";

const HIGHLIGHT_PAD = 6;

/** The visible element for an anchor (the first one with a size), or the first match. */
function findAnchor(anchor: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`));
  return all.find((el) => el.getBoundingClientRect().width > 0) ?? all[0] ?? null;
}

function measure(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    right: r.right,
    bottom: r.bottom,
  };
}

const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export interface TourProps {
  steps: TourStep[];
  /** Called with true when finished, false when skipped or closed with Escape. */
  onClose: (completed: boolean) => void;
}

/**
 * Coach-mark tour (R29): a dimmed backdrop with a highlight around each navigation item and a
 * small card that explains it. Next/Back/Skip, arrow keys, and Escape; focus stays in the card.
 */
export function Tour({ steps, onClose }: TourProps) {
  const [index, setIndex] = useState(0);
  const [anchorBox, setAnchorBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ width: 320, height: 190 });
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    if (last) onClose(true);
    else setIndex((i) => i + 1);
  }, [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Measure the anchor now and whenever the window changes (the layout may switch between
  // sidebar, rail, and bottom bar, which swaps the anchor elements).
  useLayoutEffect(() => {
    if (!step) return;
    const el = findAnchor(step.anchor);
    el?.setAttribute("data-tour-active", "true");
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setAnchorBox(measure(findAnchor(step.anchor)));
      const card = cardRef.current?.getBoundingClientRect();
      if (card && card.width > 0) setSize({ width: card.width, height: card.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      el?.removeAttribute("data-tour-active");
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  // Move focus into the card on each step, and give it back when the tour closes.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(false);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
    } else if (event.key === "Tab") {
      const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = items[0];
      const lastItem = items[items.length - 1];
      if (!first || !lastItem) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  if (!step) return null;
  const place = placePopover(anchorBox, viewport, size);

  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* Blocks the page while the tour runs; the highlight's shadow dims everything else. */}
      <div aria-hidden="true" className={clsx("absolute inset-0", !anchorBox && "bg-black/55")} />
      {anchorBox && (
        <div
          aria-hidden="true"
          data-testid="tour-highlight"
          className="pointer-events-none absolute rounded-2xl ring-2 ring-primary transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: anchorBox.top - HIGHLIGHT_PAD,
            left: anchorBox.left - HIGHLIGHT_PAD,
            width: anchorBox.width + HIGHLIGHT_PAD * 2,
            height: anchorBox.height + HIGHLIGHT_PAD * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-side={place.side}
        className="absolute w-80 max-w-[calc(100vw-1.5rem)] animate-fade-in rounded-2xl border border-border bg-surface p-5 shadow-raised"
        style={{ top: place.top, left: place.left }}
      >
        <p className="text-xs font-semibold tracking-[0.12em] text-accent-ink uppercase">
          Step {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="mt-1 font-display text-xl font-semibold text-ink">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-2 text-ink-muted">
          {step.body}
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onClose(false)}>
            Skip tour
          </Button>
          <span className="flex-1" />
          {index > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              onClick={back}
            >
              Back
            </Button>
          )}
          <Button ref={primaryRef} size="sm" onClick={next}>
            {last ? "Done" : "Next"}
            {!last && <ArrowRight aria-hidden="true" className="size-4" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
