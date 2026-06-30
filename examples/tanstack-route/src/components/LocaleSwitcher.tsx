import { useNavigate } from "@tanstack/react-router"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const navigate = useNavigate()
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(nextLocale: Locale) {
    navigate({ to: "/$locale", params: { locale: nextLocale } })
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
