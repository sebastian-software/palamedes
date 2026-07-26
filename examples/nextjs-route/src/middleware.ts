import { NextResponse, type NextRequest } from "next/server"
import { parseAcceptLanguage } from "@palamedes/core/locale"

/*
 * Kept in sync with src/lib/i18n.ts. Duplicated here because middleware runs
 * in the edge bundle, and importing the i18n module would pull the dynamic
 * .po catalog import context into it.
 */
const LOCALES = ["en", "de", "es"] as const
const DEFAULT_LOCALE = "en"

/*
 * `/` has no locale segment: negotiate one from Accept-Language and redirect.
 * Every localized page lives under /[locale], whose layout owns <html lang>.
 */
export function middleware(request: NextRequest) {
  const preferred = parseAcceptLanguage(request.headers.get("accept-language")).find(
    (tag): tag is (typeof LOCALES)[number] => (LOCALES as readonly string[]).includes(tag)
  )
  return NextResponse.redirect(new URL(`/${preferred ?? DEFAULT_LOCALE}`, request.url))
}

export const config = { matcher: "/" }
