import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";

export default async function FeedPage() {
  const t = await getTranslations("home");
  return <Card className="text-muted">{t("soon")}</Card>;
}
