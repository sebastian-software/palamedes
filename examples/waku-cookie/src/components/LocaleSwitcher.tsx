"use client"

import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

export const LocaleSwitcher = ({ locale }: { locale: Locale }) => {
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
          <form action="/set-locale" key={item.locale} method="post">
            <button
              aria-pressed={item.active}
              data-testid={item.testId}
              name="locale"
              type="submit"
              value={item.locale}
            >
              {item.locale.toUpperCase()}
            </button>
          </form>
        ))}
      </div>
    </div>
  )
}
