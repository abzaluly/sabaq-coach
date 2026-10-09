"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callRpc, int, str, toFormState, type FormState } from "@/lib/actions";

function habitArgs(form: FormData) {
  const frequency = str(form, "frequency");
  return {
    p_title: str(form, "title"),
    p_description: str(form, "description"),
    p_frequency: frequency,
    p_target_count: frequency === "daily" ? 1 : (int(form, "target_count") ?? 1),
    p_proof_type: str(form, "proof_type"),
    p_difficulty: str(form, "difficulty"),
  };
}

export async function proposeHabitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const groupId = str(form, "group_id");
  const replaces = str(form, "replaces_habit_id") || null;
  const result = await callRpc("propose_habit", { p_group_id: groupId, ...habitArgs(form), p_replaces_habit_id: replaces });
  if (!result.ok) return toFormState(result);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/habits`);
}

export async function editProposedHabitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const groupId = str(form, "group_id");
  const result = await callRpc("edit_proposed_habit", { p_habit_id: str(form, "habit_id"), ...habitArgs(form) });
  if (!result.ok) return toFormState(result);
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`/g/${groupId}/habits`);
}

export async function archiveHabitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("archive_habit", { p_habit_id: str(form, "habit_id") });
  revalidatePath(`/g/${str(form, "group_id")}`, "layout");
  return toFormState(result);
}

export async function voteHabitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("vote_habit", {
    p_habit_id: str(form, "habit_id"),
    p_vote: str(form, "vote"),
    p_comment: str(form, "comment") || null,
  });
  revalidatePath(`/g/${str(form, "group_id")}`, "layout");
  return toFormState(result);
}
