import clsx from "clsx";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  /** Small count shown after the label. */
  count?: number;
  content: ReactNode;
}

export interface TabsProps {
  /** Accessible name for the tab list. */
  label: string;
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ label, items, value, defaultValue, onChange, className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? internal;
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((t) => t.id === selected);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    const target = items[next];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    tabRefs.current.get(target.id)?.focus();
  };

  const active = items.find((t) => t.id === selected);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(tab.id)}
              className={clsx(
                "-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                isSelected
                  ? "border-primary text-ink"
                  : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-surface-muted px-1.5 text-xs text-ink-muted tabular-nums">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className="pt-5 focus-visible:outline-offset-4"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
