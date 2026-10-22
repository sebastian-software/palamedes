import { setTimeout } from "node:timers/promises";
import { defineEventHandler, getQuery } from "h3";
import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { resolveLocale, timeZone } from "#shared/locale";

const scope = createServerI18nScope();

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const locale = resolveLocale(query.locale);
  const i18n = await createBundledServerI18n({ locale, timeZone });
  return scope.run(i18n, async () => {
    const before = getI18n().locale;
    await setTimeout(Math.min(40, Math.max(0, Number(query.delay) || 0)));
    return {
      locale,
      before,
      after: getI18n().locale,
      message: t`Server query confirmed locale ${locale}.`,
    };
  });
});
