/** Where the tour card goes, relative to the highlighted navigation item. */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "right" | "top" | "bottom" | "center";
}

const GAP = 14;
const MARGIN = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the card goes: beside a sidebar or rail item, above a bottom-bar item, below anything
 * else, or centred when the anchor is missing. Always inside the window.
 */
export function placePopover(
  anchor: Box | null,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): Placement {
  if (!anchor) {
    return {
      side: "center",
      left: (viewport.width - size.width) / 2,
      top: (viewport.height - size.height) / 2,
    };
  }
  const maxLeft = viewport.width - size.width - MARGIN;
  const maxTop = viewport.height - size.height - MARGIN;
  if (anchor.right + GAP + size.width + MARGIN <= viewport.width) {
    return {
      side: "right",
      left: anchor.right + GAP,
      top: clamp(anchor.top + anchor.height / 2 - size.height / 2, MARGIN, maxTop),
    };
  }
  const left = clamp(anchor.left + anchor.width / 2 - size.width / 2, MARGIN, maxLeft);
  if (anchor.top - GAP - size.height >= MARGIN) {
    return { side: "top", left, top: anchor.top - GAP - size.height };
  }
  return { side: "bottom", left, top: clamp(anchor.bottom + GAP, MARGIN, maxTop) };
}
