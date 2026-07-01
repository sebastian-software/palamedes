"use client"

import { Link } from "waku/router/client"
import { serializeChoiceCookie } from "@palamedes/example-locale-shared"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { LOCALES, LOCALE_LABELS, syncClientI18n, type Locale } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  useClientLocale(locale, syncClientI18n)
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  return (
    <div className="switcher">
      <span className="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div className="seg" role="group" aria-label="Language">
        {items.map((item) => (
          <Link
            key={item.locale}
            data-testid={item.testId}
            aria-current={item.active ? "page" : undefined}
            to={`/${item.locale}` as never}
            onClick={() => {
              document.cookie = serializeChoiceCookie(item.locale)
            }}
          >
            {item.locale.toUpperCase()}
          </Link>
        ))}
      </div>
    </div>
  )
}
