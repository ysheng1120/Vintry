import { Sheet } from "../../components/ui/Sheet";
import { Keys } from "./Keys";
import { modifierLabel } from "./platform";

/** The "?" dialog: every keyboard shortcut, with Ctrl or ⌘ to match this computer. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shortcuts: { keys: string[]; action: string }[] = [
    { keys: ["/"], action: "Search your cellar" },
    { keys: ["N"], action: "Add wine" },
    { keys: [modifierLabel(), "K"], action: "Open the command palette" },
    { keys: ["?"], action: "Show these shortcuts" },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" variant="dialog" size="sm">
      <dl className="flex flex-col gap-3">
        {shortcuts.map(({ keys, action }) => (
          <div key={action} className="flex items-center justify-between gap-4">
            <dt className="text-ink">{action}</dt>
            <dd className="shrink-0">
              <Keys keys={keys} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm text-ink-muted">Shortcuts pause while you type in a box.</p>
    </Sheet>
  );
}
