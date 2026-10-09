import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Отправка SMS с кодом входа. Провайдер выбирается через SMS_PROVIDER:
 *   mobizon — Mobizon (Казахстан/СНГ), SMS_API_KEY, опционально SMS_SENDER и MOBIZON_API_HOST
 *   twilio  — Twilio, TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / SMS_SENDER (номер или Messaging Service SID)
 *   dev     — пишет код в файл SMS_DEV_DIR/<номер>.json (локальная разработка и e2e)
 * Supabase вызывает /api/auth/sms-hook (Send SMS Hook), тот вызывает sendSms().
 */
export async function sendSms(phone: string, text: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "dev";
  if (provider === "mobizon") {
    const host = process.env.MOBIZON_API_HOST ?? "api.mobizon.kz";
    const params = new URLSearchParams({
      output: "json",
      api: "v1",
      apiKey: process.env.SMS_API_KEY ?? "",
      recipient: phone.replace(/^\+/, ""),
      text,
    });
    if (process.env.SMS_SENDER) params.set("from", process.env.SMS_SENDER);
    const res = await fetch(`https://${host}/service/message/sendsmsmessage`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!res.ok || json.code !== 0) throw new Error(`mobizon: ${json.message ?? res.status}`);
    return;
  }
  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
    const from = process.env.SMS_SENDER ?? "";
    const body = new URLSearchParams({ To: phone, Body: text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN ?? ""}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`twilio: ${res.status}`);
    return;
  }
  if (provider === "dev") {
    if (process.env.NODE_ENV === "production" && !process.env.SMS_DEV_DIR) throw new Error("SMS provider is not configured");
    const dir = process.env.SMS_DEV_DIR ?? ".local-stack/sms";
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${phone.replace(/\D/g, "")}.json`), JSON.stringify({ phone, text, at: new Date().toISOString() }));
    return;
  }
  throw new Error(`unknown SMS_PROVIDER ${provider}`);
}

/**
 * Проверка подписи Standard Webhooks (так подписывает хуки Supabase Auth).
 * secret: "v1,whsec_<base64>"; заголовки webhook-id, webhook-timestamp, webhook-signature.
 */
export function verifyWebhook(secret: string, headers: Headers, body: string, now = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
