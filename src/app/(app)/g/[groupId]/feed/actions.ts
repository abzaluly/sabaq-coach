"use server";

import { revalidatePath } from "next/cache";
import { callRpc, str, toFormState, type FormState } from "@/lib/actions";

function refresh(form: FormData) {
  revalidatePath(`/g/${str(form, "group_id")}`, "layout");
}

export async function voteCheckinAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("vote_checkin", {
    p_checkin_id: str(form, "checkin_id"),
    p_vote: str(form, "vote"),
    p_comment: str(form, "comment") || null,
  });
  refresh(form);
  return toFormState(result);
}

export async function reactAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("toggle_reaction", { p_checkin_id: str(form, "checkin_id"), p_emoji: str(form, "emoji") });
  refresh(form);
  return toFormState(result);
}

export async function commentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("add_comment", { p_checkin_id: str(form, "checkin_id"), p_body: str(form, "body") });
  refresh(form);
  return toFormState(result);
}

export async function moderateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("moderate_checkin", { p_checkin_id: str(form, "checkin_id"), p_reason: str(form, "reason") });
  refresh(form);
  return toFormState(result);
}

export async function resolveAuditAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await callRpc("resolve_audit", { p_audit_id: Number(str(form, "audit_id")) });
  refresh(form);
  return toFormState(result);
}
