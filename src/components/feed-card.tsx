"use client";

import { AlertTriangle, Check, CheckCircle2, Clock, MessageCircle, ShieldAlert, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState } from "react";
import { commentAction, moderateAction, reactAction, voteCheckinAction } from "@/app/(app)/g/[groupId]/feed/actions";
import { Character } from "@/components/character";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError, SubmitButton, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FeedItem } from "@/lib/feed";
import { cn } from "@/lib/utils";

export const REACTIONS = ["🔥", "💪", "👏", "😂", "🤔"] as const;

export type MemberInfo = { display_name: string; nickname: string; character_seed: string };

type Props = {
  item: FeedItem;
  groupId: string;
  meId: string;
  isAdmin: boolean;
  members: Record<string, MemberInfo>;
  now: string;
  timezone: string;
};

export function FeedCard({ item, groupId, meId, isAdmin, members, now, timezone }: Props) {
  const t = useTranslations("feed");
  const format = useFormatter();
  const author = members[item.user_id];
  const mine = item.user_id === meId;
  const myVote = item.votes.find((v) => v.voter_id === meId);
  const pending = item.status === "pending" && new Date(item.review_until) > new Date(now);
  const confirms = item.votes.filter((v) => v.vote === "confirm");
  const disputes = item.votes.filter((v) => v.vote === "dispute");
  const created = new Date(item.created_at);
  const localCreated = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(created);

  return (
    <Card className="p-0">
      <header className="flex items-center gap-3 p-4 pb-3">
        <Link href={`/g/${groupId}/u/${item.user_id}`} className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring">
          <Character seed={author?.character_seed ?? item.user_id} size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {author?.display_name ?? "—"} <span className="font-normal text-muted">· {item.habit.title}</span>
          </p>
          <p className="text-xs text-muted">
            <time dateTime={item.created_at}>{format.relativeTime(created, new Date(now))}</time>
            {item.local_date < localCreated && <> · {t("forYesterday")}</>}
          </p>
        </div>
        <StatusBadge item={item} now={now} />
      </header>

      {item.proof?.url && (
        // eslint-disable-next-line @next/next/no-img-element -- подписанный URL с коротким сроком, оптимизатор не нужен
        <img src={item.proof.url} alt={t("proofAlt", { habit: item.habit.title })} className="max-h-[28rem] w-full bg-surface-2 object-cover" loading="lazy" />
      )}
      {item.habit.proof_type === "honor" && <p className="mx-4 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{t("honor")}</p>}

      <div className="space-y-3 p-4 pt-3">
        {item.note && <p className="whitespace-pre-wrap">{item.note}</p>}

        {item.proof && item.proof.flags.length > 0 && (
          <ul className="space-y-1">
            {item.proof.flags.map((f) => (
              <li key={f} className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm font-semibold">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                {t(`flag.${f}` as "flag.duplicate_image")}
              </li>
            ))}
          </ul>
        )}

        {(confirms.length > 0 || disputes.length > 0) && (
          <div className="space-y-1.5 text-sm">
            <p className="font-semibold text-muted">
              <ThumbsUp className="inline size-4" /> {confirms.length} · <ThumbsDown className="inline size-4" /> {disputes.length}
            </p>
            {disputes.map((d) => (
              <p key={d.voter_id} className="rounded-xl bg-danger/10 px-3 py-2">
                <span className="font-semibold">{members[d.voter_id]?.display_name ?? "—"}:</span> {d.comment}
              </p>
            ))}
          </div>
        )}

        {!mine && pending && <VoteBar groupId={groupId} checkinId={item.id} current={myVote?.vote} />}

        <Reactions item={item} groupId={groupId} meId={meId} />
        <Comments item={item} groupId={groupId} members={members} />
        {isAdmin && !mine && item.status !== "rejected" && <Moderate groupId={groupId} checkinId={item.id} />}
      </div>
    </Card>
  );
}

function StatusBadge({ item, now }: { item: FeedItem; now: string }) {
  const t = useTranslations("feed");
  if (item.status === "approved")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-accent">
        <CheckCircle2 className="size-4" /> {t("approved")}
      </span>
    );
  if (item.status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-danger">
        <XCircle className="size-4" /> {t("rejected")}
      </span>
    );
  const hours = Math.max(0, Math.ceil((new Date(item.review_until).getTime() - new Date(now).getTime()) / 3_600_000));
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-muted">
      <Clock className="size-4" /> {t("pendingHours", { hours })}
    </span>
  );
}

function VoteBar({ groupId, checkinId, current }: { groupId: string; checkinId: string; current?: "confirm" | "dispute" }) {
  const t = useTranslations("feed");
  const [state, action] = useActionState(voteCheckinAction, undefined);
  const [disputing, setDisputing] = useState(false);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="checkin_id" value={checkinId} />
      {disputing ? (
        <>
          <input type="hidden" name="vote" value="dispute" />
          <Textarea name="comment" required autoFocus maxLength={500} placeholder={t("disputePlaceholder")} aria-label={t("disputeReason")} />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => setDisputing(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton variant="danger" className="flex-1">
              {t("dispute")}
            </SubmitButton>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <SubmitButton name="vote" value="confirm" variant={current === "confirm" ? "primary" : "secondary"} aria-pressed={current === "confirm"}>
            <Check />
            {current === "confirm" ? t("confirmed") : t("confirm")}
          </SubmitButton>
          <Button type="button" variant={current === "dispute" ? "danger" : "secondary"} onClick={() => setDisputing(true)} aria-pressed={current === "dispute"}>
            <ThumbsDown />
            {current === "dispute" ? t("disputed") : t("dispute")}
          </Button>
        </div>
      )}
      <FormError state={state} />
    </form>
  );
}

function Reactions({ item, groupId, meId }: { item: FeedItem; groupId: string; meId: string }) {
  const t = useTranslations("feed");
  const [, action] = useActionState(reactAction, undefined);
  return (
    <form action={action} className="flex flex-wrap gap-1.5" aria-label={t("reactions")}>
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="checkin_id" value={item.id} />
      {REACTIONS.map((emoji) => {
        const count = item.reactions.filter((r) => r.emoji === emoji).length;
        const mine = item.reactions.some((r) => r.emoji === emoji && r.user_id === meId);
        return (
          <button
            key={emoji}
            type="submit"
            name="emoji"
            value={emoji}
            aria-pressed={mine}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border-2 px-2.5 text-base transition active:scale-95",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
              mine ? "border-primary bg-primary/10" : "border-border bg-surface",
            )}
          >
            {emoji}
            {count > 0 && <span className="text-sm font-bold">{count}</span>}
          </button>
        );
      })}
    </form>
  );
}

function Comments({ item, groupId, members }: { item: FeedItem; groupId: string; members: Record<string, MemberInfo> }) {
  const t = useTranslations("feed");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(commentAction, undefined);
  return (
    <div>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <MessageCircle className="size-4" />
        {t("comments", { count: item.comments.length })}
      </button>
      {open && (
        <div className="space-y-2">
          {item.comments.map((c) => (
            <p key={c.id} className="text-sm">
              <span className="font-semibold">{members[c.user_id]?.display_name ?? "—"}:</span> {c.body}
            </p>
          ))}
          <form action={action} className="flex gap-2" key={state?.at}>
            <input type="hidden" name="group_id" value={groupId} />
            <input type="hidden" name="checkin_id" value={item.id} />
            <Input name="body" required maxLength={500} placeholder={t("commentPlaceholder")} aria-label={t("commentLabel")} />
            <SubmitButton variant="secondary">{t("send")}</SubmitButton>
          </form>
          <FormError state={state} />
        </div>
      )}
    </div>
  );
}

function Moderate({ groupId, checkinId }: { groupId: string; checkinId: string }) {
  const t = useTranslations("feed");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(moderateAction, undefined);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-danger">
        <ShieldAlert className="size-4" /> {t("moderate")}
      </button>
    );
  return (
    <form action={action} className="space-y-2 rounded-xl border-2 border-danger/40 p-3">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="checkin_id" value={checkinId} />
      <p className="text-sm">{t("moderateHint")}</p>
      <Input name="reason" required maxLength={200} placeholder={t("moderateReason")} aria-label={t("moderateReason")} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        <SubmitButton variant="danger" className="flex-1">
          {t("reject")}
        </SubmitButton>
      </div>
      <FormError state={state} />
    </form>
  );
}
