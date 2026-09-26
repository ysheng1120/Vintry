import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TOAST_DURATION_MS, ToastContext, type ToastOptions, type ToastTone } from "./useToast";

interface ToastEntry extends ToastOptions {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    // Keep the newest few so a burst of actions never floods the screen.
    setToasts((list) => [...list.slice(-2), { ...options, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-[calc(var(--vt-bottom-offset,0px)+1rem)] left-4 z-[60] flex justify-center sm:left-auto sm:justify-end"
      >
        <ol aria-live="polite" className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

const toneIcon: Record<ToastTone, ReactNode> = {
  neutral: <Info className="text-info" />,
  success: <CheckCircle2 className="text-success" />,
  warning: <AlertTriangle className="text-warning" />,
  danger: <AlertTriangle className="text-danger" />,
};

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: () => void }) {
  const { title, description, action, tone = "neutral", duration = TOAST_DURATION_MS } = entry;
  const [paused, setPaused] = useState(false);
  const acted = useRef(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  // Auto-dismiss; hovering or focusing the toast pauses the countdown (it restarts on leave).
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [paused, duration]);

  const runAction = () => {
    if (!action || acted.current) return;
    acted.current = true;
    action.onClick();
    onDismissRef.current();
  };

  return (
    <li
      className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-overlay [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toneIcon[tone]}
      <div className={clsx("min-w-0 flex-1", !description && "self-center")}>
        <p className="font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={runAction}
          className="-my-1 min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={onDismiss}
        className="-my-1 -mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-subtle hover:bg-surface-muted hover:text-ink"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}
