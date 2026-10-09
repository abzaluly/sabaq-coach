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
