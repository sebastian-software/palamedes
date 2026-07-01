"use client"

import Link from "next/link"
import { serializeChoiceCookie } from "@palamedes/example-locale-shared"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "@/lib/i18n"
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
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
            href={`/${item.locale}`}
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
