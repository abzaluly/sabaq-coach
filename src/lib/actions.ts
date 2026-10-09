import "server-only";
import { rpcErrorCode, type RpcErrorCode } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: RpcErrorCode };

/** Вызов серверной функции от имени текущего пользователя (RLS и проверки в БД). */
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: rpcErrorCode(error) };
  return { ok: true, data: data as T };
}

/** Состояние формы для useActionState. */
export type FormState = { error?: RpcErrorCode; ok?: boolean; at?: number } | undefined;

export function toFormState(result: ActionResult): FormState {
  return result.ok ? { ok: true, at: Date.now() } : { error: result.error, at: Date.now() };
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export function int(form: FormData, key: string): number | null {
  const n = Number.parseInt(str(form, key), 10);
  return Number.isFinite(n) ? n : null;
}
