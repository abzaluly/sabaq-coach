import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { randomSeeds } from "@/lib/character";
import { getCurrentProfile } from "@/lib/profile";
import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata() {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.onboarded_at) redirect("/");
  const t = await getTranslations("onboarding");

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
      <OnboardingForm initialSeeds={randomSeeds(6)} />
    </main>
  );
}
