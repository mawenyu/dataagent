import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/v2/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.test.ts"],
    globals: true,
    reporters: [["default", { summary: false }]],
    server: {
      deps: {
        // dataagent fork (2026-08-16): inline @copilotkit/core so
        // vi.mock("phoenix") intercepts the core dist's top-level
        // `import { Socket } from "phoenix"`. Externalized (node_modules
        // default) modules bypass vite's mock registry — the real Phoenix
        // Socket was constructed instead of the test mock, and the
        // IntelligenceAgent /connect replay test hung waiting for a socket
        // that never registered. (Baseline failure since initial import.)
        inline: [/@copilotkit\/core/],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@copilotkit/web-inspector": resolve(
        __dirname,
        "./src/v2/__tests__/mocks/web-inspector.ts",
      ),
    },
  },
});
