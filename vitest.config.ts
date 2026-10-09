import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@config": path.resolve(import.meta.dirname, "config"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          // Тесты в транзакциях с откатом, но держим один файл за раз —
          // проще читать логи при падении.
          fileParallelism: false,
        },
      },
    ],
  },
});
