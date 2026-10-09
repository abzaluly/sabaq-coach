import { expect, test } from "@playwright/test";

// Полный сценарий «код из письма → онбординг» требует локального Supabase
// (письма читаются из Mailpit) и добавится вместе с seed на этапе 7.

test("гость попадает на страницу входа", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
});

test("неверный email показывает понятную ошибку", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Проверьте" })).toHaveText("Проверьте адрес почты");
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
});

test("тап-зоны не меньше 44px", async ({ page }) => {
  await page.goto("/login");
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
