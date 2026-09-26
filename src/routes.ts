import type { ComponentType } from "react";
import type { RouteObject } from "react-router";
import App from "./App";
import { RouteError } from "./app/ErrorBoundary";
import { NotFound } from "./app/NotFound";
import { Root, RootFallback } from "./app/Root";

type PageModule = Promise<{ default: ComponentType } & Record<string, unknown>>;

/**
 * A lazily loaded page from a feature folder. `name` picks a named export (e.g. "ScanPage");
 * feature units add or replace pages by editing only their own folder's index.tsx.
 */
function page(
  load: () => PageModule,
  name = "default",
): Pick<RouteObject, "lazy" | "ErrorBoundary"> {
  return {
    ErrorBoundary: RouteError,
    lazy: async () => {
      const mod = await load();
      const Component = mod[name] as ComponentType | undefined;
      if (!Component) throw new Error(`Page export "${name}" is missing`);
      return { Component };
    },
  };
}

export const routes: RouteObject[] = [
  {
    Component: Root,
    HydrateFallback: RootFallback,
    ErrorBoundary: RouteError,
    children: [
      // Full screen, outside the main layout.
      { path: "welcome", ...page(() => import("./features/onboarding")) },
      {
        path: "/",
        Component: App,
        ErrorBoundary: RouteError,
        children: [
          { index: true, ...page(() => import("./features/home")) },
          { path: "cellar", ...page(() => import("./features/cellar")) },
          { path: "wine/:id", ...page(() => import("./features/wine")) },
          { path: "add", ...page(() => import("./features/add")) },
          { path: "add/scan", ...page(() => import("./features/add"), "ScanPage") },
          { path: "add/describe", ...page(() => import("./features/add"), "DescribePage") },
          { path: "add/manual", ...page(() => import("./features/add"), "ManualPage") },
          { path: "import", ...page(() => import("./features/import")) },
          { path: "sommelier", ...page(() => import("./features/sommelier")) },
          {
            path: "sommelier/:threadId",
            ...page(() => import("./features/sommelier"), "ThreadPage"),
          },
          { path: "more", ...page(() => import("./features/more")) },
          { path: "history", ...page(() => import("./features/history")) },
          { path: "wishlist", ...page(() => import("./features/wishlist")) },
          { path: "stats", ...page(() => import("./features/stats")) },
          { path: "locations", ...page(() => import("./features/locations")) },
          { path: "settings", ...page(() => import("./features/settings")) },
          { path: "backup", ...page(() => import("./features/backup")) },
          { path: "help", ...page(() => import("./features/help")) },
          { path: "whats-new", ...page(() => import("./features/whats-new")) },
          { path: "*", Component: NotFound },
        ],
      },
    ],
  },
];
