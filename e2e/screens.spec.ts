import { test } from "@playwright/test";
import { createGroup, createInvite, signUp } from "./helpers";

// Скриншоты основных экранов для визуальной проверки: SCREENSHOTS_DIR=... E2E_BACKEND=1 pnpm test:e2e screens
const DIR = process.env.SCREENSHOTS_DIR;
test.skip(!DIR || !process.env.E2E_BACKEND, "только по запросу");

test("скриншоты экранов группы", async ({ browser }) => {
  const s = Date.now().toString(36).slice(-5);
  const { page } = await signUp(browser, { name: "Алия", nickname: `shot_${s}` });
  const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
  await shot("home-empty");
  const groupId = await createGroup(page, "Утренние жаворонки");
  await createInvite(page, groupId);
  await shot("settings");
  await page.goto(`/g/${groupId}/habits/new`);
  await page.getByText("Раз в неделю").click();
  await shot("habit-new");
  await page.goto(`/g/${groupId}/habits/new`);
  await page.getByLabel("Название").fill("Чтение");
  await page.getByLabel("Что считается выполнением").fill("20 страниц книги в день");
  await page.locator("label", { hasText: "Отметка" }).first().click();
  await page.getByRole("button", { name: "Отправить на одобрение" }).click();
  await page.waitForURL(/\/habits$/);
  await page.getByRole("button", { name: "Отметить" }).first().click();
  await page.getByRole("status").first().waitFor();
  await shot("habits");
  await page.goto("/");
  await shot("home");
  await page.goto(`/g/${groupId}`);
  await shot("arena");
  await page.goto(`/g/${groupId}/feed`);
  await shot("feed");
  await page.goto(`/g/${groupId}/leaderboard`);
  await shot("leaderboard");
  await page.getByRole("link", { name: /Алия/ }).first().click();
  await page.waitForURL(/\/u\//);
  await shot("profile");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => localStorage.removeItem("orle-theme"));
  await page.goto(`/g/${groupId}`);
  await shot("arena-dark");
});
