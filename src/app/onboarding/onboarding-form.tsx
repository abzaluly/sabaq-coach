"use client";

import { Check, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Character } from "@/components/character";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { randomSeeds } from "@/lib/character";
import { rpcErrorCode } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { nicknameSchema, onboardingSchema } from "@/lib/validation";

const SEED_COUNT = 6;

export function OnboardingForm({ initialSeeds, next = "/" }: { initialSeeds: string[]; next?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("");
  const [checked, setChecked] = useState<{ nickname: string; free: boolean } | null>(null);
  const [seeds, setSeeds] = useState(initialSeeds);
  const [seed, setSeed] = useState(initialSeeds[0] ?? "");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const nicknameValid = nicknameSchema.safeParse(nickname).success;
  const nickState =
    nicknameValid && checked?.nickname === nickname ? (checked.free ? "free" : "taken") : "idle";

  useEffect(() => {
    if (!nicknameValid) return;
    const timer = setTimeout(async () => {
      const { data } = await createClient().rpc("nickname_available", { p_nickname: nickname });
      setChecked({ nickname, free: data === true });
    }, 350);
    return () => clearTimeout(timer);
  }, [nickname, nicknameValid]);

  function shuffle() {
    const fresh = randomSeeds(SEED_COUNT);
    setSeeds(fresh);
    setSeed(fresh[0]!);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = onboardingSchema.safeParse({ displayName, nickname, characterSeed: seed });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return setError(
        t(field === "nickname" ? "errors.invalid_nickname" : field === "characterSeed" ? "errors.invalid_character" : "errors.invalid_display_name"),
      );
    }
    setPending(true);
    setError(undefined);
    const { error } = await createClient().rpc("complete_onboarding", {
      p_display_name: parsed.data.displayName,
      p_nickname: parsed.data.nickname,
      p_character_seed: parsed.data.characterSeed,
    });
    if (error) {
      setPending(false);
      return setError(t(`errors.${rpcErrorCode(error)}`));
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-5">
      <Card className="space-y-4">
        <div>
          <Label htmlFor="name">{t("onboarding.nameLabel")}</Label>
          <Input
            id="name"
            autoComplete="given-name"
            placeholder={t("onboarding.namePlaceholder")}
            maxLength={40}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="nickname">{t("onboarding.nicknameLabel")}</Label>
          <Input
            id="nickname"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value.replace(/\s/g, ""))}
            aria-invalid={nickState === "taken"}
            aria-describedby="nickname-hint"
          />
          <p id="nickname-hint" aria-live="polite" className={cn("mt-1.5 text-sm", nickState === "taken" ? "text-danger" : "text-muted")}>
            {nickState === "taken"
              ? t("onboarding.nicknameTaken")
              : nickState === "free"
                ? t("onboarding.nicknameFree")
                : t("onboarding.nicknameHint")}
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{t("onboarding.characterTitle")}</h2>
            <p className="text-sm text-muted">{t("onboarding.characterHint")}</p>
          </div>
          <Button type="button" variant="secondary" size="icon" onClick={shuffle} aria-label={t("onboarding.shuffle")}>
            <Shuffle />
          </Button>
        </div>
        <div role="radiogroup" aria-label={t("onboarding.characterTitle")} className="mt-4 grid grid-cols-3 gap-3">
          {seeds.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === seed}
              onClick={() => setSeed(s)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-2xl border-2 bg-surface-2 transition",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
                s === seed ? "border-primary" : "border-transparent",
              )}
            >
              <Character seed={s} stage={1} size={80} />
              {s === seed && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-fg">
                  <Check className="size-4" />
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending || nickState === "taken" || !seed}>
        {pending ? t("common.loading") : t("onboarding.finish")}
      </Button>
    </form>
  );
}
