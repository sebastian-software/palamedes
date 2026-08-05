import { t } from "@palamedes/core/macro"

import type { Locale } from "./i18n"

export function translateServerActionProof(locale: Locale): string {
  return t`Server action confirmed locale ${locale}.`
}
