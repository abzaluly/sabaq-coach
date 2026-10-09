"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callRpc, int, str, toFormState, type FormState } from "@/lib/actions";

const RULE_KEYS = [
  "habitApprovalVotes",
  "maxActiveHabits",
  "graceMinutes",
  "reviewWindowHours",
  "confirmationsToApprove",
  "collusionWindowDays",
  "checkinsPerMinute",
] as const;

export async function updateSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const groupId = str(form, "group_id");
  const rules: Record<string, unknown> = {};
  for (const key of RULE_KEYS) {
    const v = int(form, key);
    if (v !== null) rules[key] = v;
  }
  const approval = str(form, "habitApproval");
  if (approval) rules.habitApproval = approval;

  const result = await callRpc("update_group_settings", {
    p_group_id: groupId,
    p_name: str(form, "name") || null,
    p_max_members: int(form, "max_members"),
    p_season_days: int(form, "season_days"),
    p_timezone: str(form, "timezone") || null,
    p_rules: rules,
  });
  revalidatePath(`/g/${groupId}`, "layout");
  return toFormState(result);
}

export async function createInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const groupId = str(form, "group_id");
  const maxUses = int(form, "max_uses");
  const result = await callRpc("create_invite", {
    p_group_id: groupId,
    p_expires_hours: int(form, "expires_hours") ?? 168,
    p_max_uses: maxUses && maxUses > 0 ? maxUses : null,
  });
  revalidatePath(`/g/${groupId}/settings`);
  return toFormState(result);
}

export async function revokeInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("revoke_invite", { p_invite_id: str(form, "invite_id") });
  revalidatePath(`/g/${str(form, "group_id")}/settings`);
  return toFormState(result);
}

export async function memberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const groupId = str(form, "group_id");
  const userId = str(form, "user_id");
  const op = str(form, "op");
  const result =
    op === "remove"
      ? await callRpc("remove_member", { p_group_id: groupId, p_user_id: userId })
      : await callRpc("set_member_role", { p_group_id: groupId, p_user_id: userId, p_role: op });
  revalidatePath(`/g/${groupId}`, "layout");
  return toFormState(result);
}

export async function leaveGroupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("leave_group", { p_group_id: str(form, "group_id") });
  if (!result.ok) return toFormState(result);
  revalidatePath("/");
  redirect("/");
}
