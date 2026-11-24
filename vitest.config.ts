import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCachePath: join(process.cwd(), "node_modules", ".vitest-cache"),
    include: ["src/**/*.test.ts"],
    typecheck: { enabled: true, include: ["src/**/*.test-d.ts"], tsconfig: "./tsconfig.typecheck.json" },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test-d.ts"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
