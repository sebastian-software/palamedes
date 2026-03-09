"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { Locale, LOCALES, LOCALE_COOKIE } from "./i18n"

export async function setLocaleAction(locale: Locale) {
  if (!LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`)
  }

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })

  // Revalidate all pages - they'll re-render with new locale
  revalidatePath("/", "layout")
}
