import path from "node:path";
import { defineConfig } from "vitest/config";

// Отдельный конфиг, чтобы генерация иконок не запускалась вместе с тестами.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: { include: ["scripts/make-icons.tsx"], root: path.resolve(import.meta.dirname, "..") },
});
