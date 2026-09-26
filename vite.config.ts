import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const BURGUNDY = "#6d1a36";
const CREAM = "#f7f1e6";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      // Emit registerSW.js as a file (not inline) so it satisfies `script-src 'self'`.
      injectRegister: "script",
      // Public icons are already matched by workbox.globPatterns; avoid duplicate precache entries.
      includeManifestIcons: false,
      manifest: {
        name: "Vintry",
        short_name: "Vintry",
        description: "Your personal wine cellar, with an AI sommelier",
        theme_color: BURGUNDY,
        background_color: CREAM,
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Never cache Anthropic API traffic.
            urlPattern: ({ url }) => url.hostname === "api.anthropic.com",
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
