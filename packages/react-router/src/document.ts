import { useContext } from "react";

import { CATALOG_UNAVAILABLE_ATTRIBUTE, DocumentStateContext } from "./document-state";

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
  const server = useContext(DocumentStateContext);
  if (server) return server.locale;
  if (typeof document === "undefined") return undefined;
  return document.documentElement.lang || undefined;
}

/**
 * Whether the document's messages are available, so the root `Layout` can
 * render translated chrome such as navigation and a footer.
 *
 * It is `false` only in the error document of a server catalog failure, which
 * renders without the request's catalog: a `Layout` shows catalog-free markup
 * there instead of its messages. On the server the value comes from
 * `handleRequest`; in the browser from the document, so hydration renders the
 * same markup. Outside `handleRequest` it is `true`.
 */
export function useCatalogAvailable(): boolean {
  const server = useContext(DocumentStateContext);
  if (server) return server.catalogAvailable;
  if (typeof document === "undefined") return true;
  return !document.documentElement.hasAttribute(CATALOG_UNAVAILABLE_ATTRIBUTE);
}
