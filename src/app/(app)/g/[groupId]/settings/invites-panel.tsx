"use client";

import { Copy, Share2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError, Select, SubmitButton } from "@/components/ui/form";
import { Label } from "@/components/ui/input";
import type { Invite } from "@/lib/types";
import { createInviteAction, revokeInviteAction } from "./actions";

export function InvitesPanel({ groupId, invites, siteUrl }: { groupId: string; invites: Invite[]; siteUrl: string }) {
  const t = useTranslations("settings");
  const [state, action] = useActionState(createInviteAction, undefined);

  return (
    <div className="space-y-3">
      {invites.map((inv) => (
        <InviteRow key={inv.id} groupId={groupId} invite={inv} link={`${siteUrl}/join/${inv.code}`} />
      ))}
      <Card>
        <form action={action} className="space-y-3">
          <input type="hidden" name="group_id" value={groupId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="expires_hours">{t("expires")}</Label>
              <Select id="expires_hours" name="expires_hours" defaultValue="168">
                <option value="24">{t("hours24")}</option>
                <option value="168">{t("days7")}</option>
                <option value="720">{t("days30")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="max_uses">{t("maxUses")}</Label>
              <Select id="max_uses" name="max_uses" defaultValue="0">
                <option value="0">{t("unlimited")}</option>
                <option value="1">1</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </Select>
            </div>
          </div>
          <FormError state={state} />
          <SubmitButton className="w-full">{t("newInvite")}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}

function InviteRow({ groupId, invite, link }: { groupId: string; invite: Invite; link: string }) {
  const t = useTranslations("settings");
  const format = useFormatter();
  const [copied, setCopied] = useState(false);
  const [state, action] = useActionState(revokeInviteAction, undefined);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Orle", text: t("shareText"), url: link });
        return;
      } catch {
        // отменено пользователем — копируем
      }
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-bold tracking-[0.2em]">{invite.code}</p>
          <p className="text-xs text-muted">
            {invite.expires_at
              ? t("until", { date: format.dateTime(new Date(invite.expires_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })
              : t("noExpiry")}
            {" · "}
            {invite.max_uses ? t("usesOf", { uses: invite.uses, max: invite.max_uses }) : t("uses", { uses: invite.uses })}
          </p>
        </div>
        <Button variant="secondary" size="icon" onClick={share} aria-label={t("share")}>
          {copied ? <Copy /> : <Share2 />}
        </Button>
      </div>
      {copied && <p className="mt-2 text-sm font-semibold text-accent" role="status">{t("copied")}</p>}
      <form action={action} className="mt-2">
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="invite_id" value={invite.id} />
        <FormError state={state} />
        <SubmitButton variant="ghost" className="h-11 px-2 text-sm text-danger">
          {t("revoke")}
        </SubmitButton>
      </form>
    </Card>
  );
}
