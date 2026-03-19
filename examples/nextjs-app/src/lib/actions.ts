"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor } from "@palamedes/core"
import { getLocaleLabel, Locale, LOCALES, LOCALE_COOKIE } from "./i18n"
import { createActiveServerI18n } from "./i18n.server"

const serverActionMessage = defineMessage({
  message: "Server action confirmed locale {locale}.",
}) as unknown as MessageDescriptor

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
  const { i18n, locale } = await createActiveServerI18n()

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: i18n._(serverActionMessage.id ?? serverActionMessage.message ?? "", { locale }, serverActionMessage),
  }
}
