"use server";

import { revalidatePath } from "next/cache";
import { callRpc, str, toFormState, type FormState } from "@/lib/actions";

export async function equipAction(_prev: FormState, form: FormData): Promise<FormState> {
  const [kind, code] = str(form, "choice").split(":");
  const result = await callRpc("equip_cosmetic", { p_kind: kind, p_code: code || null });
  revalidatePath("/", "layout");
  return toFormState(result);
}
