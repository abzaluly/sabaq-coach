import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Character } from "@/components/character";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { requireOnboardedProfile } from "@/lib/profile";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireOnboardedProfile();
  const t = await getTranslations();

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-24 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring">
          <Character seed={profile.character_seed} stage={1} size={40} />
          <span className="text-xl font-extrabold">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <Button variant="ghost" type="submit">
              {t("common.signOut")}
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
