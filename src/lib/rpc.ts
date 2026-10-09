import type { PostgrestError } from "@supabase/supabase-js";

/** Коды ошибок, которые бросают серверные функции (см. supabase/migrations/*_rpc.sql). */
export const RPC_ERROR_CODES = [
  "not_authenticated",
  "invalid_display_name",
  "invalid_nickname",
  "invalid_character",
  "nickname_taken",
  "profile_not_found",
  "habit_not_found",
  "not_your_habit",
  "not_a_member",
  "rate_limited",
  "grace_expired",
  "habit_not_active",
  "period_closed",
  "day_frozen",
  "proof_required",
  "proof_not_found",
  "proof_already_used",
  "proof_expired",
  "note_required",
  "period_complete",
  "already_checked_in",
  "checkin_not_found",
  "cannot_vote_own",
  "review_closed",
  "comment_required",
  "admin_only",
  "invalid_settings",
  "onboarding_required",
  "invalid_group_name",
  "invalid_timezone",
  "too_many_groups",
  "invite_not_found",
  "invite_invalid",
  "already_member",
  "group_full",
  "owner_only",
  "owner_must_transfer",
  "invalid_habit_title",
  "invalid_habit_description",
  "invalid_habit_target",
  "change_already_proposed",
  "habit_limit_reached",
  "habit_not_editable",
  "voting_closed",
  "invalid_comment",
  "invalid_reaction",
  "invalid_freeze",
  "freeze_too_late",
  "freeze_limit_reached",
] as const;

/** Ошибки, которые возникают в Route Handlers до обращения к БД. */
export const APP_ERROR_CODES = ["invalid_image", "image_too_large", "upload_failed"] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number] | (typeof APP_ERROR_CODES)[number] | "generic" | "network";

/** Переводит ошибку PostgREST в ключ `errors.*` для i18n. */
export function rpcErrorCode(error: Pick<PostgrestError, "code" | "message"> | null | undefined): RpcErrorCode {
  if (!error) return "generic";
  if (error.code === "P0001") {
    const known = RPC_ERROR_CODES.find((c) => c === error.message);
    if (known) return known;
  }
  if (/fetch failed|network/i.test(error.message)) return "network";
  return "generic";
}
