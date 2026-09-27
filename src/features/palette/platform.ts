/** The parts of `navigator` used to tell a Mac from a Windows PC. */
export interface NavigatorLike {
  platform?: string;
  userAgentData?: { platform?: string };
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike);
}

/** True on a Mac (or iPad/iPhone), where shortcuts use ⌘ instead of Ctrl. */
export function isApplePlatform(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  const platform = nav?.userAgentData?.platform || nav?.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘" on a Mac, "Ctrl" elsewhere. */
export function modifierLabel(nav?: NavigatorLike): string {
  return isApplePlatform(nav ?? currentNavigator()) ? "⌘" : "Ctrl";
}

/** Ctrl+K on Windows, ⌘K on a Mac. */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return false;
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** For aria-keyshortcuts. */
export function paletteKeyshortcuts(): string {
  return isApplePlatform() ? "Meta+K" : "Control+K";
}
