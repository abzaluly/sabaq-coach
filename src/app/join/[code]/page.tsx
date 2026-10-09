import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Character } from "@/components/character";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { JoinButton } from "./join-button";

type Preview = { group_id: string; group_name: string; member_count: number; max_members: number; already_member: boolean };

export default async function JoinByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/join/${normalized}`);
  if (!profile.onboarded_at) redirect(`/onboarding?next=/join/${normalized}`);

  const t = await getTranslations("groups");
  const supabase = await createClient();
  const { data } = await supabase.rpc("invite_preview", { p_code: normalized });
  const preview = (data as Preview[] | null)?.[0];
  if (preview?.already_member) redirect(`/g/${preview.group_id}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Card className="flex flex-col items-center gap-3 text-center">
        <Character seed={profile.character_seed ?? "orle"} stage={1} size={96} />
        {preview ? (
          <>
            <p className="text-muted">{t("invitedTo")}</p>
            <h1 className="text-2xl font-extrabold">{preview.group_name}</h1>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Users className="size-4" />
              {t("membersCount", { count: preview.member_count, max: preview.max_members })}
            </p>
            <JoinButton code={normalized} full={preview.member_count >= preview.max_members} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t("inviteInvalidTitle")}</h1>
            <p className="text-muted">{t("inviteInvalidText")}</p>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/">{t("toHome")}</Link>
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
