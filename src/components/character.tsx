import { useId } from "react";
import { traitsFromSeed, type Cosmetics, type Mood, type Stage } from "@/lib/character";
import { cn } from "@/lib/utils";

type Props = {
  seed: string;
  stage?: Stage;
  mood?: Mood;
  size?: number;
  className?: string;
  title?: string;
  cosmetics?: Cosmetics;
};

/**
 * SVG-орлёнок. Стадии заметно отличаются силуэтом: яйцо, пушистый птенец,
 * подросток с крыльями, взрослый орёл с хохолком, легенда с короной-сиянием.
 */
export function Character({ seed, stage = 1, mood = "normal", size = 96, className, title, cosmetics }: Props) {
  const t = traitsFromSeed(seed);
  const id = useId().replace(/:/g, "");
  const body = `oklch(0.72 0.14 ${t.hue})`;
  const bodyDark = `oklch(0.55 0.15 ${t.hue})`;
  const belly = `oklch(0.92 0.06 ${t.bellyHue})`;
  const beak = "oklch(0.8 0.16 80)";
  const tired = mood === "tired";

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={cn("shrink-0", tired && "saturate-50", className)}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={`aurora-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.75 0.13 300)" />
          <stop offset="100%" stopColor="oklch(0.8 0.12 180)" />
        </linearGradient>
        <clipPath id={`clip-${id}`}>
          <circle cx="60" cy="60" r="58" />
        </clipPath>
        <radialGradient id={`glow-${id}`}>
          <stop offset="0%" stopColor="oklch(0.9 0.15 85)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="oklch(0.9 0.15 85)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {cosmetics?.background === "bg_meadow" && (
        <g aria-hidden clipPath={`url(#clip-${id})`}>
          <circle cx="60" cy="60" r="58" fill="oklch(0.88 0.08 140)" />
          <path d="M2 86 Q30 74 60 84 T118 80 V120 H2Z" fill="oklch(0.72 0.13 145)" />
        </g>
      )}
      {cosmetics?.background === "bg_aurora" && <circle cx="60" cy="60" r="58" fill={`url(#aurora-${id})`} opacity="0.8" aria-hidden />}
      {stage === 4 && <circle cx="60" cy="62" r="56" fill={`url(#glow-${id})`} />}

      {mood === "fire" && (
        <g aria-hidden>
          <path d="M60 4 C70 18 78 22 74 34 C70 28 66 30 60 22 C54 30 50 28 46 34 C42 22 50 18 60 4Z" fill="oklch(0.7 0.2 40)" />
          <path d="M60 14 C65 22 68 26 66 32 C63 28 60 28 60 24 C60 28 57 28 54 32 C52 26 55 22 60 14Z" fill="oklch(0.85 0.17 80)" />
        </g>
      )}

      {stage === 0 ? (
        <g>
          <ellipse cx="60" cy="70" rx="30" ry="38" fill={belly} stroke={bodyDark} strokeWidth="3" />
          {t.pattern === 0 && <path d="M34 68 L44 60 L52 70 L60 58 L68 70 L76 60 L86 68" fill="none" stroke={bodyDark} strokeWidth="3" />}
          {t.pattern === 1 && (
            <g fill={body}>
              <circle cx="48" cy="56" r="5" />
              <circle cx="70" cy="72" r="6" />
              <circle cx="52" cy="88" r="4" />
            </g>
          )}
          {t.pattern === 2 && <path d="M30 80 Q60 66 90 80" fill="none" stroke={body} strokeWidth="6" />}
        </g>
      ) : (
        <g>
          {/* легенда: хвост и золотые кончики крыльев */}
          {stage === 4 && (
            <g aria-hidden>
              <path d="M48 100 L40 116 L54 106 L60 118 L66 106 L80 116 L72 100Z" fill="oklch(0.8 0.15 85)" />
              <path d="M10 86 Q4 70 12 62 L16 74Z M110 86 Q116 70 108 62 L104 74Z" fill="oklch(0.83 0.16 85)" />
            </g>
          )}
          {/* крылья */}
          {stage >= 2 && (
            <g fill={bodyDark}>
              <path d={stage >= 3 ? "M26 66 Q2 50 10 86 Q22 84 32 82Z" : "M30 70 Q16 64 20 86 Q28 84 34 82Z"} />
              <path d={stage >= 3 ? "M94 66 Q118 50 110 86 Q98 84 88 82Z" : "M90 70 Q104 64 100 86 Q92 84 86 82Z"} />
            </g>
          )}
          {/* тело */}
          <ellipse cx="60" cy={stage === 1 ? 74 : 70} rx={stage === 1 ? 30 : 32} ry={stage === 1 ? 30 : 36} fill={body} />
          <ellipse cx="60" cy={stage === 1 ? 82 : 80} rx={stage === 1 ? 18 : 20} ry={stage === 1 ? 18 : 22} fill={belly} />
          {t.pattern === 1 && stage >= 2 && (
            <path d="M50 74 l4 4 l4 -4 M58 82 l4 4 l4 -4" stroke={bodyDark} strokeWidth="2" fill="none" />
          )}
          {/* хохолок */}
          {stage >= 3 && t.crest === 0 && <path d="M52 36 Q56 20 60 34 Q64 20 68 36Z" fill={bodyDark} />}
          {stage >= 3 && t.crest === 1 && <path d="M56 36 Q50 16 66 22 Q60 28 64 36Z" fill={bodyDark} />}
          {stage >= 3 && t.crest === 2 && <path d="M50 38 L54 24 L60 34 L66 24 L70 38Z" fill={bodyDark} />}
          {stage === 1 && <path d="M58 44 Q60 36 62 44" stroke={bodyDark} strokeWidth="3" fill="none" />}
          {/* лапки */}
          <g stroke={beak} strokeWidth="3" strokeLinecap="round">
            <path d="M50 104 v6 M46 110 h8" />
            <path d="M70 104 v6 M66 110 h8" />
          </g>
          {/* глаза */}
          {tired ? (
            <g stroke="oklch(0.25 0.03 50)" strokeWidth="3" strokeLinecap="round">
              <path d="M44 60 h10" />
              <path d="M66 60 h10" />
            </g>
          ) : (
            <g>
              <circle cx="49" cy="60" r={t.eye === 0 ? 6 : 5} fill="white" />
              <circle cx="71" cy="60" r={t.eye === 0 ? 6 : 5} fill="white" />
              <circle cx="50" cy="61" r="3" fill="oklch(0.2 0.02 50)" />
              <circle cx="72" cy="61" r="3" fill="oklch(0.2 0.02 50)" />
              {stage >= 3 && (
                <g stroke="oklch(0.2 0.02 50)" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M42 52 l12 3" />
                  <path d="M78 52 l-12 3" />
                </g>
              )}
            </g>
          )}
          {/* клюв */}
          <path d={stage >= 3 ? "M54 66 Q60 64 66 66 Q62 78 58 76Z" : "M55 67 L65 67 L60 74Z"} fill={beak} />
        </g>
      )}

      {stage === 4 && (
        <g aria-hidden fill="oklch(0.85 0.16 85)">
          <path d="M20 30 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z" />
          <path d="M98 22 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 l4.5 -1.5z" />
        </g>
      )}
      {stage > 0 && cosmetics?.accessory === "acc_scarf" && (
        <path d="M40 90 Q60 100 80 90 L80 97 Q60 107 40 97Z M70 96 l4 16 l6 -2 l-3 -14Z" fill="oklch(0.6 0.2 25)" aria-hidden />
      )}
      {stage > 0 && cosmetics?.accessory === "acc_crown" && (
        <path d="M46 40 L48 26 L55 33 L60 22 L65 33 L72 26 L74 40Z" fill="oklch(0.83 0.16 85)" stroke="oklch(0.6 0.14 70)" strokeWidth="1.5" aria-hidden />
      )}
      {stage > 0 && cosmetics?.accessory === "acc_gavel" && (
        <g aria-hidden transform="rotate(-30 100 80)">
          <rect x="92" y="70" width="18" height="9" rx="2" fill="oklch(0.5 0.08 55)" />
          <rect x="99" y="78" width="4" height="20" rx="1.5" fill="oklch(0.62 0.08 60)" />
        </g>
      )}
      {cosmetics?.frame === "frame_ember" && (
        <circle cx="60" cy="60" r="57" fill="none" stroke="oklch(0.7 0.19 45)" strokeWidth="4" strokeDasharray="10 4" aria-hidden />
      )}
      {cosmetics?.frame === "frame_gold" && (
        <g aria-hidden fill="none" stroke="oklch(0.8 0.15 85)">
          <circle cx="60" cy="60" r="57" strokeWidth="4" />
          <circle cx="60" cy="60" r="51" strokeWidth="1.5" />
        </g>
      )}

      {tired && (
        <text x="88" y="34" fontSize="14" fontWeight="700" fill="oklch(0.6 0.03 60)" aria-hidden>
          z
        </text>
      )}

      {mood === "shield" && (
        <g aria-hidden>
          <circle cx="60" cy="68" r="52" fill="none" stroke="oklch(0.75 0.12 230)" strokeWidth="3" strokeDasharray="6 5" />
          <path d="M96 84 l10 -4 l10 4 v8 q0 8 -10 12 q-10 -4 -10 -12z" fill="oklch(0.75 0.12 230)" />
        </g>
      )}
    </svg>
  );
}
