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
  await page.goto(`/g/${groupId}`);
  await shot("arena");
});
