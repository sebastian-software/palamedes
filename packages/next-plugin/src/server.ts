import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import { createServerI18nScope, type ServerI18nScope } from "@palamedes/runtime/server";
import type { I18nInstance } from "@palamedes/runtime";
import { createI18n, type CreateI18nOptions, type PalamedesI18n } from "@palamedes/core";
import { loadServerCatalog } from "@palamedes/next-plugin/server-catalogs";

const NEXT_RENDER_REQUEST_KEY_PROVIDER = Symbol.for(
  "palamedes.nextPlugin.renderRequestKeyProvider",
);

/**
 * Create an i18n scope keyed to Next.js' complete App Router render lifetime.
 * The render key remains stable when React suspends and resumes work in a
 * different async execution context.
 */
export function createNextServerI18nScope<
  T extends I18nInstance = I18nInstance,
>(): ServerI18nScope<T> {
  return createServerI18nScope<T>({
    requestKeyProvider: {
      get: () => workAsyncStorage.getStore(),
      // A stable ID lets runtime registration replace this closure during HMR
      // instead of retaining one provider for every module evaluation.
      id: NEXT_RENDER_REQUEST_KEY_PROVIDER,
    },
  });
}

export type { ServerI18nScope };

let automaticScope: ServerI18nScope<PalamedesI18n> | undefined;

/** Load the active locale once per server generation and create isolated request state. */
export async function createNextServerI18n(
  options: CreateI18nOptions & { locale: string },
): Promise<PalamedesI18n> {
  const messages = await loadServerCatalog(options.locale);
  const i18n = createI18n(options);
  i18n.load(options.locale, messages);
  (automaticScope ??= createNextServerI18nScope<PalamedesI18n>()).activate(i18n);
  return i18n;
}
