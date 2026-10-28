import { useContext } from "react";

import { DocumentLocaleContext } from "./document-locale";

/**
 * The locale of the document, for `<html lang>` in the root `Layout`.
 *
 * On the server it is the locale `handleRequest` resolved for the request,
 * including documents that no route loader ran for, such as 404 and 405
 * responses and catalog failures. In the browser it is the document's `lang`,
 * which is fixed for the document's lifetime, so hydration renders the same
 * value. Returns `undefined` when the request has no locale, for example when
 * the locale resolver threw, or outside `handleRequest`.
 */
export function useDocumentLocale(): string | undefined {
  const serverLocale = useContext(DocumentLocaleContext);
  if (serverLocale !== undefined) return serverLocale;
  if (typeof document === "undefined") return undefined;
  return document.documentElement.lang || undefined;
}
