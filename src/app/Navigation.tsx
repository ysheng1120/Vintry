import clsx from "clsx";
import { Lock } from "lucide-react";
import { Link, useLocation } from "react-router";
import { BrandMark, BrandWordmark } from "./Brand";
import type { LayoutMode } from "./layoutMode";
import { NAV_ITEMS, type NavItem } from "./navItems";

function byId(id: NavItem["id"]): NavItem {
  const item = NAV_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown nav item ${id}`);
  return item;
}

/** Sidebar and rail put Add first as the primary action; the bottom bar keeps it central. */
const SIDE_ORDER: NavItem["id"][] = ["home", "cellar", "sommelier", "more"];

function linkProps(item: NavItem, active: boolean) {
  return {
    to: item.to,
    // Full name for assistive tech; the visible label is the same or its start (WCAG 2.5.3).
    "aria-label": item.label,
    "aria-current": active ? ("page" as const) : undefined,
    "aria-keyshortcuts": item.shortcut,
    "data-tour": item.tour,
  };
}

function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={clsx(
        "rounded-md border px-1.5 font-sans text-[0.7rem] leading-5 font-medium uppercase",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function SidebarList({ pathname }: { pathname: string }) {
  const add = byId("add");
  const addActive = add.isActive(pathname);
  return (
    <ul className="flex flex-col gap-1">
      <li className="mb-4">
        <Link
          {...linkProps(add, addActive)}
          className={clsx(
            "flex min-h-11 items-center gap-2.5 rounded-xl bg-primary px-4 font-semibold text-on-primary shadow-card transition-colors hover:bg-primary-hover",
            addActive && "ring-2 ring-primary/30 ring-offset-2 ring-offset-surface",
          )}
        >
          <add.icon aria-hidden="true" className="size-5" strokeWidth={2.25} />
          <span className="flex-1">{add.label}</span>
          <Kbd className="border-on-primary/30 text-on-primary/80">N</Kbd>
        </Link>
      </li>
      {SIDE_ORDER.map((id) => {
        const item = byId(id);
        const active = item.isActive(pathname);
        return (
          <li key={id}>
            <Link
              {...linkProps(item, active)}
              className={clsx(
                "group relative flex min-h-11 items-center gap-3 rounded-xl px-4 font-medium transition-colors",
                active
                  ? "bg-primary-soft text-primary"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-2.5 bottom-2.5 -left-4 w-1 rounded-r-full bg-primary"
                />
              )}
              <item.icon aria-hidden="true" className="size-5" />
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <Kbd className="border-border text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100">
                  {item.shortcut}
                </Kbd>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RailList({ pathname }: { pathname: string }) {
  const add = byId("add");
  const addActive = add.isActive(pathname);
  return (
    <ul className="flex w-full flex-col items-center gap-1.5">
      <li className="mb-3">
        <Link
          {...linkProps(add, addActive)}
          title="Add wine (N)"
          className={clsx(
            "flex size-12 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-card transition-colors hover:bg-primary-hover",
            addActive && "ring-2 ring-primary/30 ring-offset-2 ring-offset-surface",
          )}
        >
          <add.icon aria-hidden="true" className="size-6" strokeWidth={2.25} />
        </Link>
      </li>
      {SIDE_ORDER.map((id) => {
        const item = byId(id);
        const active = item.isActive(pathname);
        return (
          <li key={id} className="w-full">
            <Link
              {...linkProps(item, active)}
              title={item.label}
              className={clsx(
                "flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[0.7rem] font-medium transition-colors",
                active ? "text-primary" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              <span
                className={clsx(
                  "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary-soft",
                )}
              >
                <item.icon aria-hidden="true" className="size-5" />
              </span>
              <span aria-hidden="true">{item.shortLabel}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BottomList({ pathname }: { pathname: string }) {
  return (
    <ul className="mx-auto grid h-full max-w-lg grid-cols-5 items-stretch px-1">
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        if (item.id === "add") {
          return (
            <li key={item.id} className="flex items-center justify-center">
              <Link
                {...linkProps(item, active)}
                className="flex flex-col items-center gap-0.5 rounded-xl text-[0.7rem] font-medium text-primary"
              >
                <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-raised ring-4 ring-bg">
                  <item.icon aria-hidden="true" className="size-6" strokeWidth={2.25} />
                </span>
                <span aria-hidden="true">{item.shortLabel}</span>
              </Link>
            </li>
          );
        }
        return (
          <li key={item.id} className="flex">
            <Link
              {...linkProps(item, active)}
              className={clsx(
                "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.7rem] font-medium",
                active ? "text-primary" : "text-ink-muted hover:text-ink",
              )}
            >
              <span
                className={clsx(
                  "flex h-7 w-12 items-center justify-center rounded-full",
                  active && "bg-primary-soft",
                )}
              >
                <item.icon aria-hidden="true" className="size-5" />
              </span>
              <span aria-hidden="true">{item.shortLabel}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Main navigation (KTD18): the same five items as a sidebar (≥1100 px), an icon rail
 * (≥720 px), or a bottom bar. Items carry data-tour anchors for the guided tour.
 */
export function Navigation({ mode }: { mode: LayoutMode }) {
  const { pathname } = useLocation();

  if (mode === "bottom") {
    return (
      <nav
        aria-label="Main"
        data-layout={mode}
        className="fixed inset-x-0 bottom-0 z-40 h-[4.5rem] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.04)]"
      >
        <BottomList pathname={pathname} />
      </nav>
    );
  }

  const sidebar = mode === "sidebar";
  return (
    <aside
      aria-label="Main navigation"
      className={clsx(
        "fixed inset-y-0 left-0 z-40 flex flex-col overflow-y-auto border-r border-border bg-surface",
        sidebar ? "w-64 px-4 pt-6 pb-5" : "w-20 items-center px-2 pt-5 pb-4",
      )}
    >
      <Link
        to="/"
        aria-label="Vintry home"
        className={clsx("flex items-center gap-3 rounded-xl", sidebar ? "mb-7 px-2 py-1" : "mb-6")}
      >
        <BrandMark className={sidebar ? "size-9" : "size-10"} />
        {sidebar && <BrandWordmark className="text-[1.6rem]" />}
      </Link>
      <nav aria-label="Main" data-layout={mode} className="w-full">
        {sidebar ? <SidebarList pathname={pathname} /> : <RailList pathname={pathname} />}
      </nav>
      {sidebar && (
        <p className="mt-auto flex items-start gap-2 rounded-xl bg-surface-muted/70 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Your cellar is stored only on this computer.
        </p>
      )}
    </aside>
  );
}
