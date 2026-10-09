import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { HabitForm } from "@/components/habit-form";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import type { Habit } from "@/lib/types";
import { editProposedHabitAction, proposeHabitAction } from "../actions";

export default async function NewHabitPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ edit?: string; replaces?: string }>;
}) {
  const { groupId } = await params;
  const { edit, replaces } = await searchParams;
  const { group, me } = await getGroupContext(groupId);
  const t = await getTranslations("habits");

  let initial: Habit | undefined;
  const sourceId = edit ?? replaces;
  if (sourceId) {
    const supabase = await createClient();
    const { data } = await supabase.from("habits").select("*").eq("id", sourceId).eq("user_id", me.id).maybeSingle();
    if (!data) notFound();
    initial = data as Habit;
  }

  const title = edit ? t("editTitle") : replaces ? t("changeTitle") : t("newTitle");
  return (
    <section>
      <h2 className="mb-1 text-lg font-bold">{title}</h2>
      {replaces && <p className="mb-3 text-sm text-muted">{t("changeNote")}</p>}
      <HabitForm
        groupId={groupId}
        scoring={group.scoring_config}
        action={edit ? editProposedHabitAction : proposeHabitAction}
        initial={initial}
        habitId={edit}
        replacesHabitId={replaces}
        submitLabel={edit ? t("save") : t("propose")}
      />
    </section>
  );
}
