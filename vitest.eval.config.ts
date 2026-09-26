import { defineConfig } from "vitest/config";

/**
 * Config for the live AI eval suite (Verification Contract "Live AI eval", U8/U9/U12). Kept
 * separate from vitest.config.ts so these cases never run under `npm test` or CI: they call the
 * real Claude API and cost real money. Run with `npm run eval:ai` (needs ANTHROPIC_API_KEY).
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("1.0.0-test") },
  test: {
    environment: "node",
    setupFiles: ["./evals/setup.ts"],
    include: ["evals/**/*.eval.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
