import { expect, type Browser, type Page } from "@playwright/test";

/** Где читать письма: SMTP-ловушка локального стека или Mailpit у `supabase start`. */
const MAIL_URL = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";

export const hasBackend = Boolean(process.env.E2E_BACKEND);

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
}

/** Адреса уникальны на каждый прогон, поэтому последнее письмо — наше. */
export async function latestCode(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAIL_URL}/latest?to=${encodeURIComponent(email)}`);
    if (res.ok) {
      const mail = (await res.json()) as { code: string | null };
      if (mail.code) return mail.code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no code for ${email}`);
}

/** Полный вход по коду из письма + онбординг. Возвращает страницу на главной. */
export async function signUp(browser: Browser, opts: { name: string; nickname: string; next?: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail(opts.nickname);
  await page.goto(opts.next ?? "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByLabel("Код из письма")).toBeVisible();
  const code = await latestCode(email);
  await page.getByLabel("Код из письма").fill(code);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Как вас зовут").fill(opts.name);
  await page.getByLabel("Никнейм").fill(opts.nickname);
  await expect(page.getByText("Никнейм свободен")).toBeVisible();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"));
  return { page, email };
}

export async function createGroup(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "Создать группу" }).click();
  await page.getByLabel("Название").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/g/")[1]!.split("/")[0]!;
}

export async function createInvite(page: Page, groupId: string): Promise<string> {
  await page.goto(`/g/${groupId}/settings`);
  await page.getByRole("button", { name: "Создать приглашение" }).click();
  const code = page.locator("p.font-mono").first();
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
  return (await code.textContent())!;
}
