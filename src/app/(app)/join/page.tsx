import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { JoinCodeForm } from "./join-code-form";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("joinTitle") };
}

export default async function JoinPage() {
  const t = await getTranslations("groups");
  return (
    <main className="mt-4">
      <BackLink href="/" />
      <h1 className="mt-2 text-2xl font-extrabold">{t("joinTitle")}</h1>
      <p className="mt-1 text-muted">{t("joinHint")}</p>
      <JoinCodeForm />
    </main>
  );
}
