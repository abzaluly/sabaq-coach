import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import type { Group, GroupRole, Member, ProfileLite, Season } from "@/lib/types";

export type GroupContext = {
  group: Group;
  me: { id: string; role: GroupRole };
  members: Member[];
  season: Season | null;
  isAdmin: boolean;
};

/** Группа, участники и моя роль. RLS вернёт пусто, если я не участник → 404. */
export const getGroupContext = cache(async (groupId: string): Promise<GroupContext> => {
  const profile = await requireOnboardedProfile();
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) notFound();
  const supabase = await createClient();

  const [{ data: group }, { data: members }, { data: season }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
    supabase
      .from("group_members")
      .select("user_id, role, joined_at, profile:profiles(id, display_name, nickname, character_seed)")
      .eq("group_id", groupId)
      .order("joined_at"),
    supabase.from("seasons").select("*").eq("group_id", groupId).eq("status", "active").maybeSingle(),
  ]);
  if (!group) notFound();

  const list = (members ?? []).map((m) => ({ ...m, profile: m.profile as unknown as ProfileLite })) as Member[];
  const mine = list.find((m) => m.user_id === profile.id);
  if (!mine) notFound();

  return {
    group: group as Group,
    me: { id: profile.id, role: mine.role },
    members: list,
    season: (season as Season | null) ?? null,
    isAdmin: mine.role === "owner" || mine.role === "admin",
  };
});

/** Сегодняшняя дата (YYYY-MM-DD) в часовом поясе группы. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Момент рендера (ISO) — передаётся клиенту, чтобы относительное время не расходилось при гидратации. */
export function serverNow(): string {
  return new Date().toISOString();
}
