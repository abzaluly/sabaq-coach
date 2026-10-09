import "server-only";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import webpush from "web-push";
import messages from "../../messages/ru.json";
import { createAdminClient } from "@/lib/supabase/admin";

type Outbox = {
  id: number;
  user_id: string;
  group_id: string | null;
  kind: "evening_reminder" | "checkin_disputed" | "weekly_digest" | "season_results";
  payload: Record<string, unknown>;
  email: string | null;
  via_push: boolean;
  via_email: boolean;
  wants: boolean;
};

export type Rendered = { title: string; body: string; url: string };

const t = createTranslator({ locale: "ru", messages, namespace: "notify" });

/** Текст и ссылка уведомления. Только данные из очереди — без пользовательского HTML. */
export function render(n: Pick<Outbox, "kind" | "payload" | "group_id">, siteUrl: string): Rendered {
  const p = n.payload;
  const group = String(p.group_name ?? "");
  const base = n.group_id ? `${siteUrl}/g/${n.group_id}` : siteUrl;
  switch (n.kind) {
    case "evening_reminder":
      return { title: t("evening_reminder.title"), body: t("evening_reminder.body", { group, count: Number(p.open_habits ?? 1) }), url: siteUrl };
    case "checkin_disputed":
      return { title: t("checkin_disputed.title"), body: t("checkin_disputed.body", { comment: String(p.comment ?? "").slice(0, 140) }), url: `${base}/feed` };
    case "weekly_digest":
      return {
        title: t("weekly_digest.title", { group }),
        body: t("weekly_digest.body", { points: Math.round(Number(p.points ?? 0)), rank: Number(p.rank ?? 1), members: Number(p.members ?? 1) }),
        url: `${base}/leaderboard?scope=week`,
      };
    case "season_results":
      return { title: t("season_results.title", { number: Number(p.number ?? 1) }), body: t("season_results.body", { group }), url: `${base}/season/${p.season_id}` };
  }
}

function vapidReady() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", pub, priv);
  return true;
}

/**
 * Email: Resend (RESEND_API_KEY) или, если не настроен, запись в файл
 * (EMAIL_DEV_DIR) — удобно для локальной проверки.
 */
async function sendEmail(to: string, msg: Rendered, siteUrl: string) {
  const text = `${msg.body}\n\n${msg.url}\n\n${t("emailFooter", { url: `${siteUrl}/settings` })}`;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Orle <noreply@example.com>", to, subject: msg.title, text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
    return;
  }
  const dir = process.env.EMAIL_DEV_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "emails.jsonl"), `${JSON.stringify({ to, subject: msg.title, text })}\n`);
  }
}

/** Забирает очередь уведомлений и рассылает: web-push на все устройства + email по настройкам. */
export async function dispatchNotifications(siteUrl: string): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_notifications", { p_limit: 200 });
  if (error) throw new Error(error.message);
  const items = (data ?? []) as Outbox[];
  const pushOk = vapidReady();
  let sent = 0;
  let failed = 0;

  for (const n of items) {
    let err: string | null = null;
    if (n.wants) {
      const msg = render(n, siteUrl);
      try {
        if (n.via_push && pushOk) {
          const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
          for (const s of subs ?? []) {
            try {
              await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 6 * 3600 });
            } catch (e) {
              const status = (e as { statusCode?: number }).statusCode;
              // Подписка устарела (браузер отписался) — удаляем.
              if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
            }
          }
        }
        if (n.via_email && n.email) await sendEmail(n.email, msg, siteUrl);
        sent++;
      } catch (e) {
        err = String(e).slice(0, 300);
        failed++;
      }
    }
    await admin.rpc("complete_notification", { p_id: n.id, p_error: err });
  }
  return { sent, failed };
}
