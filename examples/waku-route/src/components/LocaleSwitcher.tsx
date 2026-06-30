"use client"

import { useRouter } from "waku/router/client"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { LOCALES, LOCALE_LABELS, syncClientI18n, type Locale } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  useClientLocale(locale, syncClientI18n)
  const router = useRouter()
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(nextLocale: Locale) {
    router.push(`/${nextLocale}` as never)
  }

  return (
    <div className="switcher">
      <span className="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div className="seg" role="group" aria-label="Language">
        {items.map((item) => (
          <button
            key={item.locale}
            data-testid={item.testId}
            aria-pressed={item.active}
            onClick={() => handleLocaleChange(item.locale)}
            type="button"
          >
            {item.locale.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
