"use server"

import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor } from "@palamedes/core"
import { getLocaleLabel, type Locale, LOCALES } from "./i18n"
import { createActiveServerI18n } from "./i18n.server"

const serverActionMessage = defineMessage({
  message: "Server action confirmed locale {locale}.",
}) as unknown as MessageDescriptor

export async function getServerActionProof(locale: Locale) {
  if (!LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`)
  }

  const { i18n } = await createActiveServerI18n(locale)

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: i18n._(serverActionMessage.id ?? serverActionMessage.message ?? "", { locale }, serverActionMessage),
  }
}
