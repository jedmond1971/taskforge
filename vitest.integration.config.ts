import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

// Cross-tenant / authorization integration tests (SECH-85). These hit a REAL Postgres
// (the local Docker one) so they are kept out of `npm test`, which stays hermetic.
// Run with `npm run test:integration`.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/integration/**/*.itest.ts"],
    setupFiles: ["src/integration/setup.ts"],
    env: loadEnv("test", process.cwd(), ""),
    // One shared database: run files sequentially. Each file also namespaces its data.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  esbuild: { jsx: "automatic" },
});
