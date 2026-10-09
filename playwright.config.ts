import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Сквозные сценарии с двумя пользователями и загрузкой фото длиннее дефолтных 30 с.
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    // В облачных контейнерах Chromium предустановлен по нестандартному пути.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `pnpm build && pnpm start -p ${port}`,
        url: `http://localhost:${port}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
