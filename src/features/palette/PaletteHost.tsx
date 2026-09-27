import { CommandPalette } from "./CommandPalette";
import { closePaletteDialogs, useOpenPaletteDialog } from "./paletteStore";
import { ShortcutsDialog } from "./ShortcutsDialog";

/** Mount once in the app shell: renders the command palette or the shortcuts help when open. */
export function PaletteHost() {
  const open = useOpenPaletteDialog();
  return (
    <>
      {/* Mounted only while open, so the cellar is read only when someone searches it. */}
      {open === "palette" && <CommandPalette onClose={closePaletteDialogs} />}
      <ShortcutsDialog open={open === "shortcuts"} onClose={closePaletteDialogs} />
    </>
  );
}
