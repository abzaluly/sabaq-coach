import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import { ResolveButton } from "./resolve-button";

type AuditRow = {
  id: number;
  user_id: string | null;
  kind: string;
  severity: number;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
};

const KNOWN = ["suspicious_proof", "rate_limited_checkin", "checkin_disputed", "checkin_moderated", "member_removed", "role_changed", "group_settings_changed"];

/** Панель модерации owner/admin: подозрительные действия из audit_log. */
export default async function ModerationPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ all?: string }> }) {
  const { groupId } = await params;
  const { all } = await searchParams;
  const { isAdmin, members } = await getGroupContext(groupId);
  if (!isAdmin) notFound();
  const t = await getTranslations("moderation");
  const format = await getFormatter();
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(100);
  if (!all) q = q.is("resolved_at", null).gte("severity", 2);
  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];
  const names = new Map(members.map((m) => [m.user_id, m.profile.display_name]));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t("title")}</h2>
        <a href={all ? "?" : "?all=1"} className="min-h-11 content-center text-sm font-semibold text-primary">
          {all ? t("onlyOpen") : t("showAll")}
        </a>
      </div>
      <p className="text-sm text-muted">{t("hint")}</p>
      {rows.length === 0 ? (
        <Card className="text-muted">{t("empty")}</Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className={r.resolved_at ? "opacity-60" : r.severity >= 2 ? "border-amber-500/60" : undefined}>
                <p className="font-semibold">
                  {KNOWN.includes(r.kind) ? t(`kind.${r.kind}` as "kind.suspicious_proof") : r.kind}
                  {r.user_id && <span className="font-normal text-muted"> · {names.get(r.user_id) ?? t("formerMember")}</span>}
                </p>
                <p className="text-xs text-muted">{format.dateTime(new Date(r.created_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                {Array.isArray(r.details.flags) && (
                  <p className="mt-1 text-sm">{(r.details.flags as string[]).map((f) => t(`flag.${f}` as "flag.old_photo")).join(", ")}</p>
                )}
                {typeof r.details.reason === "string" && <p className="mt-1 text-sm">«{r.details.reason}»</p>}
                {!r.resolved_at && <ResolveButton groupId={groupId} auditId={r.id} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
