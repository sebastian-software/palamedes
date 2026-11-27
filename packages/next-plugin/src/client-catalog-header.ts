import { createHmac, timingSafeEqual } from "node:crypto";

/** The request header an app's Proxy sets with the locale it resolved. */
export const CLIENT_CATALOG_LOCALE_HEADER = "x-palamedes-locale";

/**
 * Signs a locale value for the internal `x-palamedes-locale` Proxy header with
 * HMAC-SHA256 so forged incoming headers are ignored when
 * `bindClientCatalogPermutations({ headerSecret })` is configured.
 */
export function signClientCatalogLocaleHeader(locale: string, secret: string): string {
  if (!secret) {
    throw new Error("signClientCatalogLocaleHeader() requires a non-empty secret.");
  }
  const mac = createHmac("sha256", secret).update(locale).digest("base64url");
  return `${locale}.${mac}`;
}

/**
 * Verifies a signed `x-palamedes-locale` header value produced by
 * `signClientCatalogLocaleHeader()` using HMAC-SHA256 and returns the plain
 * locale string, or `undefined` when the header is missing, unsigned, or fails
 * verification.
 */
export function verifyClientCatalogLocaleHeader(
  headerValue: string | null | undefined,
  secret: string,
): string | undefined {
  if (!secret) {
    throw new Error("verifyClientCatalogLocaleHeader() requires a non-empty secret.");
  }
  if (!headerValue) return;
  const separator = headerValue.lastIndexOf(".");
  if (separator <= 0) return;
  const locale = headerValue.slice(0, separator);
  const providedMac = headerValue.slice(separator + 1);
  if (!locale || !providedMac) return;
  const expectedMac = createHmac("sha256", secret).update(locale).digest("base64url");
  const providedBytes = Buffer.from(providedMac, "utf8");
  const expectedBytes = Buffer.from(expectedMac, "utf8");
  if (providedBytes.length !== expectedBytes.length) return;
  return timingSafeEqual(providedBytes, expectedBytes) ? locale : undefined;
}
