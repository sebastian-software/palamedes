"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { translateServerActionProof } from "./action-messages"
import { getLocaleLabel, type Locale, LOCALES, LOCALE_COOKIE } from "./i18n"
import { getLocale } from "./i18n.server"

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

export async function getServerActionProof() {
  return createServerActionProof()
}

export async function redirectServerActionProof() {
  const proof = await createServerActionProof()
  const query = new URLSearchParams({ locale: proof.locale, message: proof.message })
  redirect(`/server-action-probe?${query}`)
}

async function createServerActionProof() {
  await Promise.resolve()
  const { locale } = await getLocale()

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: translateServerActionProof(locale),
  }
}
