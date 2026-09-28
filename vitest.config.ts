import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify("1.0.0-test") },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    css: false,
    // Generous limits: under load (many jsdom workers, a busy CI runner) the defaults of 5 s per
    // test and 1 s per findBy made a few tests time out now and then. They pass on rerun, so
    // the limits, not the code, were the problem.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
});
