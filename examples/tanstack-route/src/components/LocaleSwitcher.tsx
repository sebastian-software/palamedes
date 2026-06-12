import { buildLocaleSwitchItems } from "@palamedes/react"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const localeSwitchItems = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  return (
    <div className="button-row">
      {localeSwitchItems.map((item) => (
        <a
          key={item.locale}
          data-testid={item.testId}
          className={`chip${item.active ? " active" : ""}`}
          href={`/${item.locale}`}
        >
          {item.label}
        </a>
      ))}
    </div>
  )
}
