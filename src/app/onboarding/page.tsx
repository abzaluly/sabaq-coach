import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { randomSeeds } from "@/lib/character";
import { getCurrentProfile } from "@/lib/profile";
import { safeNext } from "@/lib/safe-next";
import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata() {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const profile = await getCurrentProfile();
  if (!profile) {
    const tc = await getTranslations();
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <p role="alert" className="mb-4">{tc("errors.profile_not_found")}</p>
        <form action="/auth/signout" method="post">
          <Button type="submit">{tc("common.signOut")}</Button>
        </form>
      </main>
    );
  }
  if (profile.onboarded_at) redirect(next);
  const t = await getTranslations("onboarding");

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
      <OnboardingForm initialSeeds={randomSeeds(6)} next={next} />
    </main>
  );
}
