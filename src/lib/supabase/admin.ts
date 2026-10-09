import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Клиент с service_role — обходит RLS. Используется ТОЛЬКО на сервере для
 * операций, которые клиент делать не должен: загрузка обработанных пруфов,
 * подписанные ссылки на фото, крон. Никогда не передавайте его результат в браузер без фильтрации.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const PROOFS_BUCKET = "proofs";

/** Подписанные ссылки на фото. Вызывать только после того, как RLS подтвердил доступ к строкам. */
export async function signedProofUrls(paths: string[], expiresIn = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await createAdminClient().storage.from(PROOFS_BUCKET).createSignedUrls(paths, expiresIn);
  for (const item of data ?? []) if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  return map;
}
