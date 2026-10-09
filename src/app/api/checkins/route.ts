import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { InvalidImageError, MAX_UPLOAD_BYTES, processProof } from "@/lib/images";
import { rpcErrorCode, type RpcErrorCode } from "@/lib/rpc";
import { createAdminClient, PROOFS_BUCKET } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const fieldsSchema = z.object({
  habitId: z.uuid(),
  note: z.string().max(500).optional(),
  previousDay: z.enum(["0", "1"]).optional(),
});

const fail = (error: RpcErrorCode, status = 400) => NextResponse.json({ ok: false, error }, { status });

/**
 * Отметка привычки одним запросом:
 *   1) фото (если нужно) обрабатывается на сервере: EXIF/GPS удаляются, считается pHash;
 *   2) публичная версия кладётся в приватный бакет, пруф регистрируется с серверным временем;
 *   3) create_checkin вызывается ОТ ИМЕНИ пользователя — все проверки периода/слота в БД.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return fail("not_authenticated", 401);

  const form = await request.formData().catch(() => null);
  if (!form) return fail("generic");
  const parsed = fieldsSchema.safeParse({
    habitId: form.get("habit_id"),
    note: (form.get("note") as string | null) || undefined,
    previousDay: (form.get("previous_day") as string | null) || undefined,
  });
  if (!parsed.success) return fail("generic");
  const { habitId, note, previousDay } = parsed.data;

  // RLS: привычка видна, только если я в её группе.
  const { data: habit } = await supabase
    .from("habits")
    .select("id, group_id, user_id, proof_type")
    .eq("id", habitId)
    .maybeSingle();
  if (!habit) return fail("habit_not_found", 404);
  if (habit.user_id !== uid) return fail("not_your_habit", 403);

  let proofId: string | null = null;
  let storagePath: string | null = null;
  const admin = createAdminClient();

  if (habit.proof_type !== "honor") {
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) return fail("proof_required");
    if (file.size > MAX_UPLOAD_BYTES) return fail("image_too_large", 413);

    let processed;
    try {
      processed = await processProof(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      return fail(e instanceof InvalidImageError && e.message === "too_large" ? "image_too_large" : "invalid_image");
    }

    storagePath = `${habit.group_id}/${uid}/${crypto.randomUUID()}.webp`;
    const upload = await admin.storage
      .from(PROOFS_BUCKET)
      .upload(storagePath, processed.image, { contentType: processed.contentType, upsert: false });
    if (upload.error) return fail("upload_failed", 502);

    const { data: proof, error } = await admin.rpc("register_proof", {
      p_user_id: uid,
      p_group_id: habit.group_id,
      p_storage_path: storagePath,
      p_phash: processed.phash,
      p_exif_taken_at: processed.takenAt?.toISOString() ?? null,
    });
    if (error || !proof) {
      await admin.storage.from(PROOFS_BUCKET).remove([storagePath]);
      return fail(rpcErrorCode(error));
    }
    proofId = (proof as { id: string }).id;
  }

  const { data: checkin, error } = await supabase.rpc("create_checkin", {
    p_habit_id: habitId,
    p_note: note ?? null,
    p_proof_id: proofId,
    p_previous_day: previousDay === "1",
  });

  const created = checkin as { id: string | null } | null;
  if (error || !created?.id) {
    if (proofId && storagePath) {
      await admin.rpc("discard_proof", { p_proof_id: proofId });
      await admin.storage.from(PROOFS_BUCKET).remove([storagePath]);
    }
    // create_checkin возвращает NULL при rate limit (чтобы аудит не откатился).
    return fail(error ? rpcErrorCode(error) : "rate_limited", error ? 400 : 429);
  }
  return NextResponse.json({ ok: true, checkin: created });
}
