import { z } from "zod";

// Те же правила, что и в CHECK-ограничениях/функциях БД. Клиентская проверка —
// только для удобства; сервер проверяет всё повторно.

export const emailSchema = z.email().max(254);
export const otpSchema = z.string().regex(/^\d{6}$/);

export const nicknameSchema = z.string().regex(/^[A-Za-z0-9_]{3,20}$/);
export const displayNameSchema = z.string().trim().min(1).max(40);

export const onboardingSchema = z.object({
  displayName: displayNameSchema,
  nickname: nicknameSchema,
  characterSeed: z.string().min(1).max(64),
});

/**
 * Нормализует телефон в E.164. Казахстанские/российские номера можно вводить как
 * 8 700 …, 7 700 … или +7 700 …; остальные — с кодом страны через «+».
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let e164: string;
  if (/^8\d{10}$/.test(digits)) e164 = `+7${digits.slice(1)}`;
  else if (/^7\d{10}$/.test(digits)) e164 = `+${digits}`;
  else if (/^\+\d{10,15}$/.test(digits)) e164 = digits;
  else return null;
  return e164;
}
