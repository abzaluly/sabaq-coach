import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createGroup, createInvite, hasBackend, latestCode, signUp, uniqueEmail } from "./helpers";

test.skip(!hasBackend, "нужен запущенный Supabase (E2E_BACKEND=1)");

const STACK = path.resolve(import.meta.dirname, "../.local-stack");

async function smsCode(phoneDigits: string): Promise<string> {
  const file = path.join(STACK, "sms", `${phoneDigits}.json`);
  for (let i = 0; i < 40; i++) {
    if (existsSync(file)) {
      const code = (JSON.parse(readFileSync(file, "utf8")) as { text: string }).text.match(/\d{6}/)?.[0];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no sms");
}

test("PWA: манифест, service worker и офлайн-страница доступны без входа", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await request.get("/sw.js")).ok()).toBe(true);
  expect((await request.get("/offline.html")).ok()).toBe(true);
  expect((await request.get("/icons/icon-512.png")).ok()).toBe(true);
});

test("вход по SMS, привязка email, уведомление о споре приходит на почту через крон", async ({ browser, request }) => {
  const s = Date.now().toString(36).slice(-5);
  const { page: alice } = await signUp(browser, { name: "Алия", nickname: `ali6_${s}` });
  const groupId = await createGroup(alice, "Уведомления");
  const code = await createInvite(alice, groupId);

  // Боб входит по телефону.
  const digits = `7700${String(Date.now()).slice(-7)}`;
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await bob.goto(`/join/${code}`);
  await bob.getByRole("tab", { name: "Телефон" }).click();
  await bob.getByLabel("Номер телефона").fill(`8${digits.slice(1)}`);
  await bob.getByRole("button", { name: "Получить код" }).click();
  await bob.getByLabel("Код из SMS").fill(await smsCode(digits));
  await bob.getByRole("button", { name: "Войти" }).click();
  await expect(bob).toHaveURL(/\/onboarding/);
  await bob.getByLabel("Как вас зовут").fill("Бауыржан");
  await bob.getByLabel("Никнейм").fill(`bau6_${s}`);
  await expect(bob.getByText("Никнейм свободен")).toBeVisible();
  await bob.getByRole("button", { name: "Начать" }).click();
  await bob.getByRole("button", { name: "Вступить" }).click();
  await expect(bob).toHaveURL(new RegExp(`/g/${groupId}$`));

  // Боб привязывает email к тому же аккаунту.
  const bobEmail = uniqueEmail(`bau6${s}`);
  await bob.goto("/settings");
  await expect(bob.getByText(`+${digits}`)).toBeVisible();
  await bob.getByRole("button", { name: "Привязать" }).first().click();
  await bob.getByLabel("Новый email").fill(bobEmail);
  await bob.getByRole("button", { name: "Получить код" }).click();
  await bob.getByLabel(/Код отправлен/).fill(await latestCode(bobEmail));
  await bob.getByRole("button", { name: "Подтвердить" }).click();
  await expect(bob.getByText(bobEmail)).toBeVisible();

  // Настройки уведомлений сохраняются.
  await bob.getByLabel("Итоги недели").uncheck();
  await bob.getByRole("button", { name: "Сохранить уведомления" }).click();
  await expect(bob.getByText("Сохранено")).toBeVisible();

  // Привычка → отметка → Алия оспаривает.
  await bob.goto(`/g/${groupId}/habits/new`);
  await bob.getByLabel("Название").fill("Растяжка");
  await bob.getByLabel("Что считается выполнением").fill("15 минут растяжки утром");
  await bob.locator("label", { hasText: "Отметка" }).first().click();
  await bob.getByRole("button", { name: "Отправить на одобрение" }).click();
  await alice.goto(`/g/${groupId}/votes`);
  await alice.getByRole("button", { name: "Одобрить" }).click();
  await bob.goto(`/g/${groupId}/habits`);
  await bob.getByRole("button", { name: "Отметить" }).click();
  await expect(bob.getByRole("status")).toBeVisible();
  await alice.goto(`/g/${groupId}/feed`);
  await alice.getByRole("button", { name: "Оспорить" }).click();
  await alice.getByLabel("Причина спора").fill("Не верю, покажи фото");
  await alice.getByRole("button", { name: "Оспорить" }).click();
  await expect(alice.getByText("Отклонено")).toBeVisible();

  // Крон: без секрета — 401; с секретом — отправляет письмо Бобу.
  expect((await request.get("/api/cron/tick")).status()).toBe(401);
  const res = await request.get("/api/cron/tick", { headers: { authorization: "Bearer local-cron-secret" } });
  expect(res.ok()).toBe(true);
  const emails = readFileSync(path.join(STACK, "email", "emails.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const mine = emails.filter((e) => e.to === bobEmail);
  expect(mine.map((e) => e.subject)).toContain("Вашу отметку оспорили");
  expect(mine.find((e) => e.subject === "Вашу отметку оспорили").text).toContain("Не верю, покажи фото");

  // В журнале Боба — штраф за фейк.
  await bob.goto(`/g/${groupId}/leaderboard`);
  await expect(bob.getByText("-15")).toBeVisible();
});
