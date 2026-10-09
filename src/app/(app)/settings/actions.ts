"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { str, type FormState } from "@/lib/actions";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

const prefsSchema = z.object({
  evening_reminder: z.boolean(),
  reminder_time: z.string().regex(/^\d{2}:\d{2}$/),
  checkin_disputed: z.boolean(),
  weekly_digest: z.boolean(),
  via_push: z.boolean(),
  via_email: z.boolean(),
});

export async function savePrefsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const profile = await requireOnboardedProfile();
  const parsed = prefsSchema.safeParse({
    evening_reminder: form.get("evening_reminder") === "on",
    reminder_time: str(form, "reminder_time"),
    checkin_disputed: form.get("checkin_disputed") === "on",
    weekly_digest: form.get("weekly_digest") === "on",
    via_push: form.get("via_push") === "on",
    via_email: form.get("via_email") === "on",
  });
  if (!parsed.success) return { error: "invalid_settings", at: Date.now() };
  const supabase = await createClient();
  // RLS: пользователь пишет только свою строку.
  const { error } = await supabase.from("notification_prefs").upsert({ user_id: profile.id, ...parsed.data });
  revalidatePath("/settings");
  return error ? { error: "generic", at: Date.now() } : { ok: true, at: Date.now() };
}

const subSchema = z.object({
  endpoint: z.url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

export async function savePushSubscription(json: string): Promise<boolean> {
  const profile = await requireOnboardedProfile();
  const parsed = subSchema.safeParse(JSON.parse(json));
  if (!parsed.success) return false;
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: profile.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
    { onConflict: "endpoint" },
  );
  return !error;
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function saveNameAction(_prev: FormState, form: FormData): Promise<FormState> {
  const profile = await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", {
    p_display_name: str(form, "display_name"),
    p_nickname: profile.nickname,
    p_character_seed: profile.character_seed,
  });
  revalidatePath("/", "layout");
  return error ? { error: "invalid_display_name", at: Date.now() } : { ok: true, at: Date.now() };
}
