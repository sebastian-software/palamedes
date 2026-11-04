import { CLIENT_CATALOG_LOCALE_HEADER } from "./client-catalog-locale-header";

export { CLIENT_CATALOG_LOCALE_HEADER as PALAMEDES_LOCALE_HEADER };

/**
 * Experimental: hands the locale a Proxy resolved to the server-side client
 * chunk selection of `experimentalClientCatalogPermutations`. Returns request
 * headers for `NextResponse.next()` or `NextResponse.rewrite()`:
 *
 * ```ts
 * return NextResponse.next({
 *   request: { headers: setRequestLocale(request.headers, locale) },
 * });
 * ```
 *
 * Any incoming value of the header is overwritten, so a client cannot pick
 * another locale's chunks. Routes under a root `[locale]` segment need no
 * header: the binding reads the root param first.
 */
export function setRequestLocale(headers: Headers, locale: string): Headers {
  const next = new Headers(headers);
  next.set(CLIENT_CATALOG_LOCALE_HEADER, locale);
  return next;
}
