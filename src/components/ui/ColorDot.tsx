import clsx from "clsx";
import { WINE_COLOUR_LABELS, type WineColourName } from "./wineColours";

const dotClass: Record<WineColourName, string> = {
  red: "bg-wine-red",
  white: "bg-wine-white",
  rose: "bg-wine-rose",
  sparkling: "bg-wine-sparkling",
  dessert: "bg-wine-dessert",
  fortified: "bg-wine-fortified",
  orange: "bg-wine-orange",
};

export interface ColorDotProps {
  color: WineColourName;
  /** Hide from assistive tech when the colour is already written next to it. */
  decorative?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** A round swatch for a wine colour. */
export function ColorDot({ color, decorative = false, size = "md", className }: ColorDotProps) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : WINE_COLOUR_LABELS[color]}
      aria-hidden={decorative || undefined}
      className={clsx(
        "inline-block shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15",
        size === "md" ? "size-3" : "size-2.5",
        dotClass[color],
        className,
      )}
    />
  );
}
