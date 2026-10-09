/** Часовые пояса для выбора в настройках группы (сервер проверяет любые IANA-имена). */
export const COMMON_TIMEZONES = [
  "Asia/Almaty",
  "Asia/Qyzylorda",
  "Asia/Aqtobe",
  "Asia/Aqtau",
  "Asia/Oral",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Novosibirsk",
  "Asia/Yekaterinburg",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Seoul",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
] as const;

export function timezoneLabel(tz: string, now = new Date()): string {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return `${tz.split("/").pop()?.replace(/_/g, " ")} (${offset ?? tz})`;
}
