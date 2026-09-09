import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    extends: [...nextCoreWebVitals, ...nextTypescript],
  },
  {
    rules: {
      // eslint-config-next 16 bundles the React Compiler-readiness rule set as
      // errors by default. This project doesn't use React Compiler, and this
      // specific rule flags every "sync local state from a server-refreshed
      // prop" and "reset debounced search state" effect across the codebase
      // (20+ pre-existing, correct usages) as an error. Downgraded to a
      // warning rather than disabled outright, so genuinely new misuse still
      // surfaces. react-hooks/static-components stays an error — it caught a
      // real bug (IssueList's SortIcon defined inside render) during the
      // Next.js 14->16 upgrade (SECH-81).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);