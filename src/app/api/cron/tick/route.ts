import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { dispatchNotifications } from "@/lib/notify";
import { createAdminClient, PROOFS_BUCKET } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Тик планировщика: решения по отметкам → закрытие периодов → сезоны → рассылка уведомлений.
 * Основной путь — pg_cron внутри БД (см. миграцию 0600); этот маршрут — запасной
 * (Vercel Cron / любой внешний cron) и уборка неиспользованных фото в хранилище.
 * Идемпотентен: можно вызывать сколько угодно часто.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();

  const { data: result, error } = await admin.rpc("run_tick");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: stale } = await admin.rpc("stale_proofs");
  const paths = ((stale ?? []) as { storage_path: string }[]).map((p) => p.storage_path);
  if (paths.length > 0) await admin.storage.from(PROOFS_BUCKET).remove(paths);

  const notifications = await dispatchNotifications(publicEnv.NEXT_PUBLIC_SITE_URL);

  return NextResponse.json({ ok: true, ...(result as object), stale_proofs_removed: paths.length, notifications });
}
