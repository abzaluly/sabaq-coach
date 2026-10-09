"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Character } from "@/components/character";
import { Card } from "@/components/ui/card";
import { FormError, Select, SubmitButton } from "@/components/ui/form";
import type { GroupRole, Member } from "@/lib/types";
import { memberAction } from "./actions";

export function MembersPanel({ groupId, members, myId, myRole }: { groupId: string; members: Member[]; myId: string; myRole: GroupRole }) {
  return (
    <ul className="space-y-2">
      {members.map((m) => (
        <li key={m.user_id}>
          <MemberRow groupId={groupId} member={m} canManage={m.user_id !== myId && m.role !== "owner" && (myRole === "owner" || m.role === "member")} isOwner={myRole === "owner"} />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({ groupId, member, canManage, isOwner }: { groupId: string; member: Member; canManage: boolean; isOwner: boolean }) {
  const t = useTranslations("settings");
  const tr = useTranslations("roles");
  const [state, action] = useActionState(memberAction, undefined);

  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <Character seed={member.profile.character_seed} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{member.profile.display_name}</p>
          <p className="truncate text-xs text-muted">
            @{member.profile.nickname} · {tr(member.role)}
          </p>
        </div>
      </div>
      {canManage && (
        <form
          action={action}
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            const op = new FormData(e.currentTarget).get("op");
            const msg = op === "remove" ? t("confirmRemove") : op === "owner" ? t("confirmTransfer") : null;
            if (msg && !window.confirm(msg)) e.preventDefault();
          }}
        >
          <input type="hidden" name="group_id" value={groupId} />
          <input type="hidden" name="user_id" value={member.user_id} />
          <Select name="op" aria-label={t("action")} defaultValue="">
            <option value="" disabled>
              {t("action")}
            </option>
            {isOwner && member.role !== "admin" && <option value="admin">{t("makeAdmin")}</option>}
            {isOwner && member.role === "admin" && <option value="member">{t("makeMember")}</option>}
            {isOwner && <option value="owner">{t("makeOwner")}</option>}
            <option value="remove">{t("remove")}</option>
          </Select>
          <SubmitButton variant="secondary">{t("apply")}</SubmitButton>
        </form>
      )}
      <FormError state={state} className="mt-2" />
    </Card>
  );
}
