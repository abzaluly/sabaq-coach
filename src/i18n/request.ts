import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "./config";

// Локаль хранится в cookie, без префикса в URL: так ссылки-инвайты одинаковы для всех.
export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Asia/Almaty",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
