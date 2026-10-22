import { setTimeout } from "node:timers/promises";
import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url }) => {
  const locale = locals.locale;
  const before = getI18n().locale;
  await setTimeout(Math.min(40, Math.max(0, Number(url.searchParams.get("delay")) || 0)));
  return Response.json({
    locale,
    before,
    after: getI18n().locale,
    message: t`Server query confirmed locale ${locale}.`,
  });
};
