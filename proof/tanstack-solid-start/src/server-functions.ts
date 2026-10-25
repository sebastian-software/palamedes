import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test";
import { getI18n } from "@palamedes/runtime";
import { t } from "@palamedes/core/macro";
import { helper } from "./server-helper";
export const documentLocale = createServerFn({ method: "GET" }).handler(() => getI18n().locale);
export const status = createServerFn({ method: "GET" }).handler(async () => {
  const before = getI18n().locale;
  await waitForServerI18nTestBarrier(getRequest());
  return {
    locale: getI18n().locale,
    before,
    message: t`Server function confirmed locale.`,
    helper: helper(),
  };
});
