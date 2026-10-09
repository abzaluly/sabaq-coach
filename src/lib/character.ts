/**
 * Процедурный персонаж Orle — «орлёнок». Полностью оригинальный: внешность
 * детерминированно выводится из seed, стадия — из очков, настроение — из стрика.
 * Чистые функции без React, чтобы их можно было тестировать и использовать на сервере.
 */

export type Stage = 0 | 1 | 2 | 3 | 4;
export type Mood = "normal" | "fire" | "tired" | "shield";

/** Пороги очков для стадий: яйцо → птенец → подросток → орёл → легенда. */
export const STAGE_THRESHOLDS = [0, 50, 250, 800, 2000] as const;

export function stageForPoints(points: number): Stage {
  let stage: Stage = 0;
  STAGE_THRESHOLDS.forEach((min, i) => {
    if (points >= min) stage = i as Stage;
  });
  return stage;
}

export function moodFor({ streak, missedRecently, frozen }: { streak: number; missedRecently: boolean; frozen: boolean }): Mood {
  if (frozen) return "shield";
  if (missedRecently) return "tired";
  if (streak >= 7) return "fire";
  return "normal";
}

export type Traits = {
  hue: number;
  bellyHue: number;
  crest: 0 | 1 | 2;
  pattern: 0 | 1 | 2;
  eye: 0 | 1;
};

/** cyrb53-подобный хэш строки → 32 бита. */
function hash(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/** mulberry32 — детерминированный ГПСЧ. */
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function traitsFromSeed(seed: string): Traits {
  const r = rng(seed);
  const hue = Math.floor(r() * 360);
  return {
    hue,
    bellyHue: (hue + 30 + Math.floor(r() * 40)) % 360,
    crest: Math.floor(r() * 3) as Traits["crest"],
    pattern: Math.floor(r() * 3) as Traits["pattern"],
    eye: Math.floor(r() * 2) as Traits["eye"],
  };
}

export function randomSeeds(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID().slice(0, 12));
}
