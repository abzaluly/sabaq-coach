import { getTranslations } from "next-intl/server";
import { Character } from "@/components/character";
import { ThemeToggle } from "@/components/theme-toggle";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <div className="mt-6 flex flex-col items-center text-center">
        <Character seed="orle" stage={3} mood="fire" size={120} />
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight">{t("app.name")}</h1>
        <p className="mt-2 text-muted">{t("app.tagline")}</p>
      </div>
      <div className="mt-10">
        <LoginForm next={safeNext(next)} linkError={error === "link" ? t("login.linkFailed") : undefined} />
      </div>
    </main>
  );
}
