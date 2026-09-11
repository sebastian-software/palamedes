import type { ParentProps } from "solid-js";
import { getRequestEvent, HydrationScript } from "@solidjs/web";
import { locales, type Locale } from "./lib/i18n";
import { resolveCookieLocale } from "./lib/server";

function resolveDocumentLocale(): Locale {
  if (typeof document !== "undefined") {
    const locale = document.documentElement.lang;
    if (!locales.isLocale(locale)) {
      throw new Error(
        `Expected a supported server document locale, received ${JSON.stringify(locale)}`,
      );
    }
    return locale;
  }

  return resolveCookieLocale(getRequestEvent()?.request).locale;
}

function resolveDocumentNonce(): string | undefined {
  if (typeof document !== "undefined") {
    return document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || undefined;
  }
  const requestNonce = getRequestEvent()?.request.headers.get("x-csp-nonce");
  if (requestNonce) return requestNonce;
  return typeof process !== "undefined" ? process.env.PALAMEDES_CSP_NONCE : undefined;
}

export default function Document(props: ParentProps) {
  const locale = resolveDocumentLocale();

  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <HydrationScript nonce={resolveDocumentNonce()} />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
