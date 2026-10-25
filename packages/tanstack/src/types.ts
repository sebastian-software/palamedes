import type { I18nInstance } from "@palamedes/runtime";
import type { TanStackCatalogDeliveryOptions, TanStackServerI18nOptions } from "./server";

/**
 * Creates one fresh request-local i18n instance. The incoming request is the
 * original TanStack Start request, including its headers and cookies.
 */
export type TanStackI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

/** Resolve only request policy; catalog loading remains adapter-owned. */
export type TanStackLocaleResolver = (request: Request) => string | Promise<string>;

/** Resolve optional request-local formatting settings alongside the locale. */
export type TanStackI18nOptionsResolver = (
  request: Request,
) => Omit<TanStackServerI18nOptions, "locale"> | Promise<Omit<TanStackServerI18nOptions, "locale">>;

export type TanStackServerI18nRequestMiddlewareOptions = {
  /** Adapter-owned production HTML catalog delivery. */
  readonly catalogDelivery?: TanStackCatalogDeliveryOptions | false;
};
