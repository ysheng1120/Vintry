import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  closePaletteDialogs,
  getOpenPaletteDialog,
  openPalette,
  openShortcuts,
} from "../features/palette/paletteStore";
import { isPaletteShortcut } from "../features/palette/platform";

export const CELLAR_SEARCH_ID = "cellar-search";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Focus an element once it appears (the page may still be loading), for up to ~2 s. */
function focusWhenReady(id: string, attempts = 40) {
  const el = document.getElementById(id);
  if (el) {
    el.focus();
    return;
  }
  if (attempts > 0) window.setTimeout(() => focusWhenReady(id, attempts - 1), 50);
}

/**
 * KTD18 shortcuts: "/" opens the cellar and focuses its search box; "n" opens Add; "?" lists the
 * shortcuts. These are ignored while typing, with modifier keys, or while a dialog is open.
 * Ctrl+K (⌘K on a Mac) opens or closes the command palette, even from a text box.
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isPaletteShortcut(event)) {
        const open = getOpenPaletteDialog();
        // Leave other dialogs (an edit sheet, the tour) in charge of the keyboard.
        if (!open && document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        if (open === "palette") closePaletteDialogs();
        else openPalette();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      if (event.key === "/") {
        event.preventDefault();
        if (pathname !== "/cellar") void navigate("/cellar");
        focusWhenReady(CELLAR_SEARCH_ID);
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        if (pathname !== "/add") void navigate("/add");
      } else if (event.key === "?") {
        event.preventDefault();
        openShortcuts();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, pathname]);
}
