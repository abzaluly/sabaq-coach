import { expect, test } from "@playwright/test";
import { createGroup, createInvite, hasBackend, signUp } from "./helpers";

test.skip(!hasBackend, "нужен запущенный Supabase (E2E_BACKEND=1)");

test("группа: создание, инвайт, вступление, привычка на голосовании, одобрение", async ({ browser }) => {
  const suffix = Date.now().toString(36).slice(-5);
  const { page: alice } = await signUp(browser, { name: "Алия", nickname: `aliya_${suffix}` });
  const groupId = await createGroup(alice, "Жаворонки");
  await expect(alice.getByText("проверка отметок слабая")).toBeVisible();
  const code = await createInvite(alice, groupId);

  // Боб открывает ссылку-приглашение, ещё не имея аккаунта.
  const { page: bob } = await signUp(browser, { name: "Бауыржан", nickname: `baur_${suffix}`, next: `/join/${code}` });
  await expect(bob.getByRole("heading", { name: "Жаворонки" })).toBeVisible();
  await bob.getByRole("button", { name: "Вступить" }).click();
  await expect(bob).toHaveURL(new RegExp(`/g/${groupId}$`));
  await expect(bob.getByRole("img", { name: "Алия" })).toBeVisible();

  // Боб предлагает привычку.
  await bob.getByRole("link", { name: "Мои привычки" }).click();
  await bob.getByRole("link", { name: "Добавить" }).click();
  await bob.getByLabel("Название").fill("Бег");
  await bob.getByLabel("Что считается выполнением").fill("Пробежка 3 км, скрин трекера");
  await bob.getByText("Раз в неделю").click();
  await bob.getByLabel("Сколько раз в неделю").fill("3");
  await bob.getByRole("button", { name: "Отправить на одобрение" }).click();
  await expect(bob.getByText("На голосовании")).toBeVisible();

  // Алия видит её на голосовании и одобряет (1 из 1 — большинство).
  await alice.goto(`/g/${groupId}/votes`);
  await expect(alice.getByText("Бег")).toBeVisible();
  await alice.getByRole("button", { name: "Одобрить" }).click();
  await expect(alice.getByText("Сейчас нечего одобрять.")).toBeVisible();

  await bob.reload();
  await expect(bob.getByText("На голосовании")).toHaveCount(0);
  await expect(bob.getByText("3 раза в неделю")).toBeVisible();
});
