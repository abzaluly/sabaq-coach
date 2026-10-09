import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { AccountLinks } from "./account-links";
import { NameForm } from "./name-form";
import { PrefsForm, type Prefs } from "./prefs-form";
import { PushToggle } from "./push-toggle";

export async function generateMetadata() {
  const t = await getTranslations("settingsPage");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const profile = await requireOnboardedProfile();
  const t = await getTranslations("settingsPage");
  const supabase = await createClient();
  const [{ data: prefs }, { data: user }] = await Promise.all([
    supabase.from("notification_prefs").select("*").eq("user_id", profile.id).maybeSingle(),
    supabase.auth.getUser(),
  ]);

  return (
    <main className="mt-4 space-y-6">
      <BackLink href="/" />
      <h1 className="text-2xl font-extrabold">{t("title")}</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("notifications")}</h2>
        <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
        <PrefsForm prefs={(prefs as Prefs | null) ?? null} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("account")}</h2>
        <NameForm name={profile.display_name} />
        <AccountLinks email={user.user?.email ?? null} phone={user.user?.phone || null} smsEnabled={process.env.NEXT_PUBLIC_SMS_ENABLED === "true"} />
      </section>
    </main>
  );
}
