import { t } from "@palamedes/core/macro";
import type { Route } from "./+types/server-status";
import { getLocaleLabel, resolveLocaleFromRequest } from "~/lib/i18n";
import { serverI18n } from "~/lib/i18n.server";

export async function loader({ request }: Route.LoaderArgs) {
  return serverI18n.run(request, async () => {
    const resolved = resolveLocaleFromRequest(request);
    return {
      proof: {
        handledAt: new Date().toISOString(),
        locale: resolved.locale,
        localeLabel: getLocaleLabel(resolved.locale),
        message: t`Server query confirmed locale ${resolved.locale}.`,
      },
    };
  });
}
