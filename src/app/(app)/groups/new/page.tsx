import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { CreateGroupForm } from "./create-group-form";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("createTitle") };
}

export default async function NewGroupPage() {
  const t = await getTranslations("groups");
  return (
    <main className="mt-4">
      <BackLink href="/" />
      <h1 className="mt-2 text-2xl font-extrabold">{t("createTitle")}</h1>
      <CreateGroupForm />
    </main>
  );
}
