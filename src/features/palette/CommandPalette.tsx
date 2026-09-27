import clsx from "clsx";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import {
  isThemePreference,
  readCachedPreference,
  resolveTheme,
  systemPrefersDark,
} from "../../app/theme";
import { ColorDot } from "../../components/ui/ColorDot";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/useToast";
import { getSetting, setSetting, SETTING_KEYS } from "../../db/settings";
import { useCellarList } from "../../domain/selectors";
import { startTour } from "../tour/tourStore";
import { nextThemeFor, searchPalette, type PaletteItem } from "./search";

const CELLAR_QUERY = { includeDrunk: true };

/**
 * Ctrl/⌘+K: one box to jump to any page, run a quick action, or open a wine. Arrow keys move
 * through the results (announced through aria-activedescendant), Enter runs one, Escape closes.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const rows = useCellarList(CELLAR_QUERY);
  const groups = useMemo(() => searchPalette(query, rows ?? []), [query, rows]);
  const items = groups.flatMap((g) => g.items);
  const activeIndex = items.length ? Math.min(active, items.length - 1) : -1;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // optionId only depends on baseId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  async function toggleTheme() {
    const stored = await getSetting<unknown>(SETTING_KEYS.theme, readCachedPreference());
    const systemDark = systemPrefersDark();
    const next = nextThemeFor(isThemePreference(stored) ? stored : "system", systemDark);
    await setSetting(SETTING_KEYS.theme, next);
    const dark = resolveTheme(next, systemDark) === "dark";
    toast({ title: dark ? "Dark mode on" : "Dark mode off", tone: "success" });
  }

  function run(item: PaletteItem) {
    onClose();
    const action = item.run;
    if (action.kind === "navigate") {
      void navigate(action.to);
    } else if (action.kind === "tour") {
      startTour();
      void navigate("/");
    } else {
      toggleTheme().catch(() => toast({ title: "Couldn't change the theme", tone: "danger" }));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!count) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) run(item);
    }
  }

  // Where each group's options start in the flat list the arrow keys move through.
  const starts = groups.map((_, g) =>
    groups.slice(0, g).reduce((sum, group) => sum + group.items.length, 0),
  );

  return (
    <Sheet open onClose={onClose} title="Search Vintry" variant="dialog" initialFocus={inputRef}>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Pages, actions, or wines…"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-xl border border-border-strong bg-surface py-2 pr-3 pl-9 text-ink transition-colors duration-150 placeholder:text-ink-subtle hover:border-ink-subtle focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-ring/30"
        />
      </div>

      <div className="mt-3 h-[min(22rem,50dvh)] overflow-y-auto">
        <div id={listId} role="listbox" aria-label="Results">
          {groups.map((group, g) => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${baseId}-${group.id}`}
              className="pb-2"
            >
              <div
                id={`${baseId}-${group.id}`}
                role="presentation"
                className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase"
              >
                {group.heading}
              </div>
              {group.items.map((item, j) => {
                const i = (starts[g] ?? 0) + j;
                const selected = i === activeIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => {
                      if (!selected) setActive(i);
                    }}
                    // Keep focus in the search box so the keyboard keeps working.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(item)}
                    className={clsx(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2",
                      selected ? "bg-primary-soft text-primary" : "text-ink",
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {item.icon ? (
                        <item.icon aria-hidden="true" className="size-4.5" />
                      ) : item.colour ? (
                        <ColorDot color={item.colour} decorative />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                    {item.hint && (
                      <span
                        className={clsx(
                          "hidden max-w-[45%] shrink-0 truncate text-sm sm:block",
                          selected ? "text-primary/80" : "text-ink-muted",
                        )}
                      >
                        {item.hint}
                      </span>
                    )}
                    <CornerDownLeft
                      aria-hidden="true"
                      className={clsx("size-4 shrink-0", !selected && "invisible")}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-ink-muted">
            No matches for “{query.trim()}”.
          </p>
        )}
      </div>

      <p role="status" className="sr-only">
        {items.length === 1 ? "1 result" : `${items.length} results`}
      </p>
      <p aria-hidden="true" className="mt-3 text-xs text-ink-subtle">
        ↑ ↓ to move · Enter to open · Esc to close
      </p>
    </Sheet>
  );
}
