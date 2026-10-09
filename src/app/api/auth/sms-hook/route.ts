import { NextResponse, type NextRequest } from "next/server";
import { createTranslator } from "next-intl";
import messages from "../../../../../messages/ru.json";
import { sendSms, verifyWebhook } from "@/lib/sms";

export const runtime = "nodejs";

const t = createTranslator({ locale: "ru", messages, namespace: "sms" });

/**
 * Supabase Auth → Send SMS Hook. Подключение: Dashboard → Authentication → Hooks →
 * Send SMS → HTTPS → https://<ваш-домен>/api/auth/sms-hook, секрет → SEND_SMS_HOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  const body = await request.text();
  if (!secret || !verifyWebhook(secret, request.headers, body)) {
    return NextResponse.json({ error: { http_code: 401, message: "invalid signature" } }, { status: 401 });
  }
  const payload = JSON.parse(body) as { user?: { phone?: string }; sms?: { otp?: string } };
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) return NextResponse.json({ error: { http_code: 400, message: "bad payload" } }, { status: 400 });
  try {
    await sendSms(phone.startsWith("+") ? phone : `+${phone}`, t("code", { code: otp }));
  } catch (e) {
    console.error("sms hook", e);
    return NextResponse.json({ error: { http_code: 502, message: "sms provider failed" } }, { status: 502 });
  }
  return NextResponse.json({});
}
