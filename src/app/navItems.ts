import {
  ChartColumn,
  CircleHelp,
  Ellipsis,
  Gift,
  Heart,
  History,
  House,
  MapPin,
  MessageCircle,
  Plus,
  Settings,
  ShieldCheck,
  Wine,
  type LucideIcon,
} from "lucide-react";

export interface MoreLink {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** Secondary screens reached from More (and shown on the More page). */
export const MORE_LINKS: MoreLink[] = [
  { to: "/history", label: "History", description: "Every change, with undo", icon: History },
  { to: "/wishlist", label: "Wishlist", description: "Wines you want to buy", icon: Heart },
  { to: "/stats", label: "Stats", description: "Your cellar in numbers", icon: ChartColumn },
  { to: "/locations", label: "Locations", description: "Racks, fridges, and bins", icon: MapPin },
  {
    to: "/backup",
    label: "Backup & restore",
    description: "Keep your records safe",
    icon: ShieldCheck,
  },
  {
    to: "/settings",
    label: "Settings",
    description: "AI key, theme, and currency",
    icon: Settings,
  },
  { to: "/help", label: "Help", description: "How to use Vintry", icon: CircleHelp },
  { to: "/whats-new", label: "What's new", description: "Recent changes to Vintry", icon: Gift },
];

export interface NavItem {
  id: "home" | "cellar" | "add" | "sommelier" | "more";
  to: string;
  /** Accessible name and label in the sidebar. */
  label: string;
  /** Visible label in the rail and bottom bar; must be the start of `label` (WCAG 2.5.3). */
  shortLabel: string;
  icon: LucideIcon;
  /** Stable anchor for the guided tour (R29). */
  tour: string;
  /** Key from the keyboard shortcuts, announced with aria-keyshortcuts. */
  shortcut?: string;
  isActive: (pathname: string) => boolean;
}

const startsWith = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    to: "/",
    label: "Home",
    shortLabel: "Home",
    icon: House,
    tour: "tour-home",
    isActive: (p) => p === "/",
  },
  {
    id: "cellar",
    to: "/cellar",
    label: "Cellar",
    shortLabel: "Cellar",
    icon: Wine,
    tour: "tour-cellar",
    shortcut: "/",
    isActive: (p) => startsWith(p, "/cellar") || startsWith(p, "/wine"),
  },
  {
    id: "add",
    to: "/add",
    label: "Add wine",
    shortLabel: "Add",
    icon: Plus,
    tour: "tour-add",
    shortcut: "n",
    isActive: (p) => startsWith(p, "/add") || startsWith(p, "/import"),
  },
  {
    id: "sommelier",
    to: "/sommelier",
    label: "Sommelier",
    shortLabel: "Sommelier",
    icon: MessageCircle,
    tour: "tour-sommelier",
    isActive: (p) => startsWith(p, "/sommelier"),
  },
  {
    id: "more",
    to: "/more",
    label: "More",
    shortLabel: "More",
    icon: Ellipsis,
    tour: "tour-more",
    isActive: (p) => startsWith(p, "/more") || MORE_LINKS.some((l) => startsWith(p, l.to)),
  },
];
