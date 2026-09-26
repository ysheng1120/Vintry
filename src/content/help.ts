/**
 * The Help page ("How to use Vintry", R29). Task-based sections in plain, short sentences.
 * The setup steps here must agree with docs/SETUP.md (launcher, install, AI key, backups,
 * moving data, privacy).
 */

export type HelpBlock =
  | { kind: "text"; text: string }
  /** Numbered steps. */
  | { kind: "steps"; items: string[] }
  /** A bulleted list. */
  | { kind: "list"; items: string[] }
  | { kind: "shortcuts"; items: { keys: string; action: string }[] };

export interface HelpSection {
  /** Anchor id, e.g. "ai-key" for /help#ai-key. */
  id: string;
  title: string;
  blocks: HelpBlock[];
  /** Screens that help with this task. */
  links?: { to: string; label: string }[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "add",
    title: "Add a bottle",
    blocks: [
      { kind: "text", text: "Click Add wine (or press N). Choose the quickest way for you:" },
      {
        kind: "list",
        items: [
          "Scan a label: take or upload a photo, and Vintry fills in the details.",
          "Describe it: type one sentence, like “6 bottles of 2019 Ridge Monte Bello at $250 from K&L”.",
          "Add by hand: a short form. It works offline and without an AI key.",
          "Import a file: bring in a CSV from CellarTracker, Vivino, or a spreadsheet.",
        ],
      },
      {
        kind: "text",
        text: "Scan and describe give you a draft first. Check it, change anything, then save. If you already have that wine, Vintry adds the bottles to it instead of making a copy.",
      },
    ],
    links: [{ to: "/add", label: "Add wine" }],
  },
  {
    id: "drink",
    title: "Drink a bottle",
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the wine from Home or Cellar.",
          "Click Drink.",
          "Choose how many, and add a rating, a note, or the occasion if you like.",
        ],
      },
      {
        kind: "text",
        text: "Vintry keeps the record. A wine with no bottles left stays under the Drunk filter in Cellar.",
      },
    ],
  },
  {
    id: "move",
    title: "Move bottles",
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the wine and click Move.",
          "Choose the new location and how many bottles to move. Add a bin if you like.",
        ],
      },
      { kind: "text", text: "Set up your racks, fridges, and cellars under More → Locations." },
    ],
    links: [{ to: "/locations", label: "Locations" }],
  },
  {
    id: "undo",
    title: "Undo a change",
    blocks: [
      {
        kind: "text",
        text: "Every change shows a message with an Undo button. You can also undo from More → History, as long as no later change touched the same wine.",
      },
    ],
    links: [{ to: "/history", label: "History" }],
  },
  {
    id: "sommelier",
    title: "Ask the sommelier",
    blocks: [
      {
        kind: "text",
        text: "Open Sommelier and ask a question, like “What should I open with lamb tonight?”. It looks only at your own cellar and suggests only bottles you have.",
      },
      {
        kind: "text",
        text: "The sommelier can suggest changes, like drinking or moving a bottle. Nothing changes until you confirm it.",
      },
      { kind: "text", text: "The sommelier needs an AI key." },
    ],
    links: [{ to: "/sommelier", label: "Sommelier" }],
  },
  {
    id: "import",
    title: "Import from CellarTracker or Vivino",
    blocks: [
      {
        kind: "steps",
        items: [
          "Export your cellar as a CSV file from CellarTracker or Vivino.",
          "In Vintry, click Add wine → Import a file, and choose the file.",
          "Check the preview. Nothing is saved until you click Import.",
        ],
      },
      {
        kind: "text",
        text: "CellarTracker and Vivino files need no AI key. For other CSV files, AI can suggest which column is which, and you can correct it.",
      },
    ],
    links: [{ to: "/import", label: "Import" }],
  },
  {
    id: "backup",
    title: "Back up and move to a new computer",
    blocks: [
      {
        kind: "text",
        text: "Your cellar lives in your browser on this computer. Back it up now and then.",
      },
      {
        kind: "list",
        items: [
          "Open More → Backup & restore and click Export backup. Save the file somewhere safe, for example a cloud-synced folder.",
          "In Chrome and Edge you can choose a backup folder once. After that, Back up now saves a dated file there in one click and keeps the newest 10.",
          "Vintry reminds you to back up after 20 changes or 14 days.",
        ],
      },
      { kind: "text", text: "To move your cellar to another computer or browser:" },
      {
        kind: "steps",
        items: [
          "On the old one: More → Backup & restore → Export backup.",
          "On the new one: start Vintry and, on the first screen, choose Restore from a Vintry backup. Later, use More → Backup & restore → Restore from backup.",
        ],
      },
      {
        kind: "text",
        text: "A restore replaces everything on that computer. Vintry saves a safety copy first, and you can undo.",
      },
    ],
    links: [{ to: "/backup", label: "Backup & restore" }],
  },
  {
    id: "install",
    title: "Install Vintry as an app",
    blocks: [
      {
        kind: "text",
        text: "Installing gives Vintry its own icon and window, and it helps the browser keep your data.",
      },
      {
        kind: "list",
        items: [
          "Chrome or Edge (Windows or Mac): click the install icon at the right end of the address bar (a small screen with an arrow). Or open the browser menu and choose Install Vintry (Edge: Apps → Install this site as an app).",
          "Safari on Mac: choose File → Add to Dock.",
        ],
      },
      {
        kind: "text",
        text: "This matters in Safari: Safari can remove data of websites you have not visited for 7 days, but it keeps the data of apps in your Dock. The Dock app keeps its own data, so move your cellar into it with a backup (see above).",
      },
      {
        kind: "text",
        text: "If you use the launcher, double-click Start Vintry.command (Mac) or Start Vintry.bat (Windows) and keep its window open while you use Vintry. Your browser opens Vintry at http://localhost:47821.",
      },
    ],
  },
  {
    id: "ai-key",
    title: "Get an AI key",
    blocks: [
      {
        kind: "text",
        text: "Vintry works without AI. With an AI key you can also scan labels, add wine by typing one sentence, get drinking-window estimates, tidy tasting notes, map unusual CSV files, and ask the sommelier.",
      },
      {
        kind: "text",
        text: "Vintry uses Anthropic's Claude. You pay Anthropic directly for what you use. There is no subscription.",
      },
      {
        kind: "steps",
        items: [
          "Go to console.anthropic.com and create an account.",
          "Open Billing and add a small amount of credit (for example $5). Set a monthly spend limit under Limits if you want a hard cap.",
          "Open API Keys, click Create Key, name it “Vintry”, and copy the key (it starts with sk-ant-).",
          "In Vintry, open More → Settings, paste the key, and click Test key.",
        ],
      },
      {
        kind: "text",
        text: "In Settings you can also choose the AI model. Each option shows what one label scan costs with it, and Settings shows your AI usage and its estimated cost.",
      },
    ],
    links: [{ to: "/settings", label: "Settings" }],
  },
  {
    id: "privacy",
    title: "Privacy",
    blocks: [
      {
        kind: "list",
        items: [
          "Your cellar and your AI key stay in your browser on your computer. Vintry has no server and no account.",
          "When you use an AI feature, only what that feature needs goes to Anthropic under your own key: the label photo you scan, the sentence you type, the tasting note you tidy, the wine details for a drinking-window estimate, the CSV headers and sample rows you ask it to map, or the cellar details the sommelier looks up.",
          "The microphone button uses your browser's own speech service (in Chrome, that sends your voice to Google).",
          "Anyone who can use your computer's browser can open Vintry. Remove your key in Settings if you share the computer.",
        ],
      },
    ],
  },
  {
    id: "updating",
    title: "Updating Vintry",
    blocks: [
      {
        kind: "list",
        items: [
          "Your own web address: it updates by itself. Vintry shows “A new version is available” with a Reload button.",
          "Launcher: download the latest ZIP and unzip it over your Vintry folder. Double-click the launcher again. Your data stays, because the address http://localhost:47821 does not change.",
        ],
      },
      { kind: "text", text: "See More → What's new for the list of changes." },
    ],
    links: [{ to: "/whats-new", label: "What's new" }],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    blocks: [
      {
        kind: "shortcuts",
        items: [
          { keys: "/", action: "Search your cellar" },
          { keys: "N", action: "Add wine" },
          { keys: "Esc", action: "Close a panel or dialog" },
        ],
      },
    ],
  },
];
