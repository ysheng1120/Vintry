import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { applyTheme, readCachedPreference, resolveTheme, systemPrefersDark } from "./app/theme";
import { routes } from "./routes";
import "./styles/index.css";

// Paint the saved theme before React starts, so a forced light or dark theme never flashes.
applyTheme(resolveTheme(readCachedPreference(), systemPrefersDark()));

const router = createBrowserRouter(routes);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
