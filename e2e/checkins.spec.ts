import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createGroup, createInvite, hasBackend, signUp } from "./helpers";

test.skip(!hasBackend, "нужен запущенный Supabase (E2E_BACKEND=1)");

async function jpeg(opts: { date: string; color: string }) {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: opts.color } })
    .composite([{ input: Buffer.from(`<svg width="640" height="480"><circle cx="200" cy="240" r="120" fill="#123"/></svg>`) }])
    .jpeg()
    .withExif({ IFD0: { Make: "Cam" }, IFD2: { DateTimeOriginal: opts.date }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 0/1 0/1" } })
    .toBuffer();
}

async function proposeHabit(page: Page, groupId: string, title: string, proof: "Фото" | "Отметка") {
  await page.goto(`/g/${groupId}/habits/new`);
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Что считается выполнением").fill(`${title}: конкретно и измеримо`);
  await page.locator("label", { hasText: proof }).first().click();
  await page.getByRole("button", { name: "Отправить на одобрение" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/habits$`));
}

test("отметки: фото без EXIF в ленте, флаг старого фото, спор, отметка-честное слово", async ({ browser }) => {
  const s = Date.now().toString(36).slice(-5);
  const { page: alice } = await signUp(browser, { name: "Алия", nickname: `ali3_${s}` });
  const groupId = await createGroup(alice, "Проверка");
  const code = await createInvite(alice, groupId);
  const { page: bob } = await signUp(browser, { name: "Бауыржан", nickname: `bau3_${s}`, next: `/join/${code}` });
  await bob.getByRole("button", { name: "Вступить" }).click();
  await expect(bob).toHaveURL(new RegExp(`/g/${groupId}$`));

  await proposeHabit(bob, groupId, "Отжимания", "Фото");
  await proposeHabit(bob, groupId, "Медитация", "Отметка");
  await alice.goto(`/g/${groupId}/votes`);
  for (let i = 0; i < 2; i++) await alice.getByRole("button", { name: "Одобрить" }).first().click();
  await expect(alice.getByText("Сейчас нечего одобрять.")).toBeVisible();

  // Боб отмечает «Медитацию» одним нажатием на главной.
  await bob.goto("/");
  const meditation = bob.locator("li", { hasText: "Медитация" });
  await meditation.getByRole("button", { name: "Отметить" }).click();
  await expect(meditation.getByRole("status")).toHaveText(/На проверке/);

  // «Отжимания» — фото со старой датой съёмки.
  const pushups = bob.locator("li", { hasText: "Отжимания" });
  await pushups.locator('input[type="file"]').setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg({ date: "2025:01:01 10:00:00", color: "#e0a060" }),
  });
  await expect(pushups.getByRole("status")).toHaveText(/На проверке/);

  // Повторная отметка того же дня невозможна: кнопки больше нет.
  await bob.reload();
  await expect(bob.locator("li", { hasText: "Медитация" }).getByRole("button", { name: "Отметить" })).toHaveCount(0);

  // Алия видит обе отметки в ленте; фото — без EXIF, с флагом «старое фото».
  await alice.goto(`/g/${groupId}/feed`);
  const card = alice.locator("li", { hasText: "Отжимания" });
  await expect(card.getByText("Фото снято больше суток назад")).toBeVisible();
  const img = card.getByRole("img", { name: /Фото-подтверждение/ });
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  const served = Buffer.from(await (await fetch(src!)).arrayBuffer());
  const meta = await sharp(served).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.exif).toBeUndefined();

  // Спор: без комментария нельзя, с комментарием — виден всем.
  await card.getByRole("button", { name: "Оспорить" }).click();
  await card.getByLabel("Причина спора").fill("Это фото из прошлого года");
  await card.getByRole("button", { name: "Оспорить" }).click();
  // В группе из 2 человек один «против» = больше половины судей → отклонено сразу.
  await expect(card.getByText("Отклонено")).toBeVisible();
  await expect(card.getByText("Это фото из прошлого года")).toBeVisible();

  // Боб не может голосовать за себя: у своих отметок нет кнопок.
  await bob.goto(`/g/${groupId}/feed`);
  await expect(bob.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
  await expect(bob.locator("li", { hasText: "Медитация" }).getByRole("button", { name: "🔥" })).toBeVisible();

  // Модерация видит подозрительное фото.
  await alice.goto(`/g/${groupId}/moderation`);
  await expect(alice.getByText("Подозрительное фото")).toBeVisible();
});
