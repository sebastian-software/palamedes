"use server"

import { t } from "@palamedes/core/macro"
import { getLocaleLabel, type Locale, LOCALES } from "./i18n"
import { createActiveServerI18n } from "./i18n.server"

export async function getServerActionProof(locale: Locale) {
  if (!LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`)
  }

  await createActiveServerI18n(locale)

  return {
    locale,
    localeLabel: getLocaleLabel(locale),
    handledAt: new Date().toISOString(),
    message: t`Server action confirmed locale ${locale}.`,
  }
}
