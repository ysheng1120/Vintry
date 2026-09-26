import clsx from "clsx";
import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";
import { useMediaQuery } from "./useMediaQuery";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky action row at the bottom (e.g. Cancel / Save). */
  footer?: ReactNode;
  /** "auto": side panel on wide windows, centred dialog on narrow ones. */
  variant?: "auto" | "side" | "dialog";
  size?: "sm" | "md" | "lg";
  role?: "dialog" | "alertdialog";
  /** Element to focus on open; defaults to the first focusable element in the body. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Hide the × button (ConfirmDialog uses its own buttons). */
  hideClose?: boolean;
  /** Clicking the backdrop closes the sheet unless this is false. */
  closeOnBackdrop?: boolean;
}

const sideWidths = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl" };
const dialogWidths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Modal panel: focus is trapped inside, Escape closes, and focus returns to whatever
 * was focused before it opened.
 */
export function Sheet(props: SheetProps) {
  if (!props.open) return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({
  onClose,
  title,
  description,
  children,
  footer,
  variant = "auto",
  size = "md",
  role = "dialog",
  initialFocus,
  hideClose = false,
  closeOnBackdrop = true,
}: SheetProps) {
  const wide = useMediaQuery("(min-width: 720px)", true);
  const hasBody = children !== undefined && children !== null && children !== false;
  const asSide = variant === "side" || (variant === "auto" && wide);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Move focus in on open; restore it on close. Also stop the page behind from scrolling.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target =
      initialFocus?.current ??
      (bodyRef.current ? focusableIn(bodyRef.current)[0] : undefined) ??
      (panel ? focusableIn(panel)[0] : undefined) ??
      panel;
    target?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
    // Runs once per open; initialFocus is read at open time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const inside = active instanceof Node && panelRef.current.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex",
        asSide ? "justify-end" : "items-center justify-center p-4",
      )}
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
        onMouseDown={() => {
          if (closeOnBackdrop) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-variant={asSide ? "side" : "dialog"}
        className={clsx(
          "relative flex max-h-full w-full flex-col bg-surface shadow-overlay focus:outline-none",
          asSide
            ? clsx("h-full animate-sheet-in border-l border-border", sideWidths[size])
            : clsx(
                "max-h-[calc(100dvh-2rem)] animate-dialog-in rounded-2xl border border-border",
                dialogWidths[size],
              ),
        )}
      >
        <header
          className={clsx(
            "flex items-start gap-3 px-6 pt-5 pb-4",
            hasBody && "border-b border-border",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          {!hideClose && (
            <IconButton
              label="Close"
              icon={<X />}
              onClick={() => onCloseRef.current()}
              className="-mt-1 -mr-2"
            />
          )}
        </header>
        {hasBody && (
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
        )}
        {footer && (
          <footer
            className={clsx(
              "mt-auto flex flex-wrap items-center justify-end gap-2 rounded-b-2xl bg-surface px-6 py-4",
              hasBody && "border-t border-border",
            )}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
