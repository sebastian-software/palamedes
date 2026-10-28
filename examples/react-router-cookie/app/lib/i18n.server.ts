import path from "node:path";
import { createScopedI18nRunner } from "@palamedes/runtime/server";
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import { resolveLocaleFromRequest } from "./i18n";

export const serverI18n = createScopedI18nRunner(
  (request) =>
    createBundledServerI18n({
      locale: resolveLocaleFromRequest(request).locale,
      timeZone: "Europe/Berlin",
    }),
  { failureMessage: "The page catalog could not be loaded." },
);

export const catalogDelivery = createViteCatalogDelivery({
  clientDirectory: path.resolve(process.cwd(), "build/client"),
  development: process.env.NODE_ENV !== "production",
});
