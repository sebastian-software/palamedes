import { Link } from "@tanstack/react-router"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"

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
            to="/$locale"
            params={{ locale: item.locale }}
          >
            {item.locale.toUpperCase()}
          </Link>
        ))}
      </div>
    </div>
  )
}
