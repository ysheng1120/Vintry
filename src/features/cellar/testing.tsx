/**
 * Test harness for the cellar screens: a memory router with the real pages, the toast provider,
 * and the real (fake-indexeddb) database. Import only from `*.test.tsx` files.
 */
/* eslint-disable react-refresh/only-export-components -- test-only module, never hot-reloaded */
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { ToastProvider } from "../../components/ui/Toast";
import ManualPage from "../add/ManualPage";
import LocationsPage from "../locations";
import WineDetailPage from "../wine";
import CellarPage from ".";

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname + location.search}</output>;
}

function Layout() {
  return (
    <ToastProvider>
      <CurrentPath />
      <Outlet />
    </ToastProvider>
  );
}

const stub = (title: string) => () => <h1>{title}</h1>;

export function renderCellarApp(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        Component: Layout,
        children: [
          { index: true, Component: stub("Home") },
          { path: "cellar", Component: CellarPage },
          { path: "wine/:id", Component: WineDetailPage },
          { path: "add", Component: stub("Add wine") },
          { path: "add/manual", Component: ManualPage },
          { path: "locations", Component: LocationsPage },
          { path: "sommelier", Component: stub("Sommelier") },
          { path: "history", Component: stub("History") },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { router, user };
}
