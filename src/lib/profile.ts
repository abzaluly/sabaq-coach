import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
  nickname: z.string().nullable(),
  character_seed: z.string().nullable(),
  onboarded_at: z.string().nullable(),
});

export type Profile = z.infer<typeof profileSchema>;

/** Текущий пользователь и его профиль (один запрос на рендер). */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, nickname, character_seed, onboarded_at")
    .eq("id", uid)
    .maybeSingle();
  return data ? profileSchema.parse(data) : null;
});

/** Для страниц приложения: гость → /login, без онбординга → /onboarding. */
export async function requireOnboardedProfile() {
  const profile = await getCurrentProfile();
  // Гостей отсекает proxy.ts; если сессия есть, а профиля нет — онбординг покажет ошибку
  // (редирект на /login здесь дал бы петлю: proxy вернёт авторизованного на /).
  if (!profile?.onboarded_at) redirect("/onboarding");
  return profile as Profile & { display_name: string; nickname: string; character_seed: string };
}
