"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callRpc, int, str, toFormState, type FormState } from "@/lib/actions";

export async function createGroupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc<{ id: string }>("create_group", {
    p_name: str(form, "name"),
    p_timezone: str(form, "timezone") || "Asia/Almaty",
    p_season_days: int(form, "season_days") ?? 30,
    p_max_members: int(form, "max_members") ?? 12,
  });
  if (!result.ok) return toFormState(result);
  revalidatePath("/");
  redirect(`/g/${result.data.id}`);
}

export async function joinGroupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc<{ group_id: string }>("join_group", { p_code: str(form, "code") });
  if (!result.ok) return toFormState(result);
  revalidatePath("/");
  redirect(`/g/${result.data.group_id}`);
}
