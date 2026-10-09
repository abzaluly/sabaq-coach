export const locales = ["ru", "kk", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ru";
/** Языки, для которых уже есть переводы. Остальные откатываются на defaultLocale. */
export const availableLocales: readonly Locale[] = ["ru"];
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function resolveLocale(value: string | undefined): Locale {
  return availableLocales.find((l) => l === value) ?? defaultLocale;
}
