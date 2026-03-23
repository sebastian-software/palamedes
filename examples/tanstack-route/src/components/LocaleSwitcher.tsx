import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"

interface LocaleSwitcherProps {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <a
          key={candidate}
          data-testid={`locale-switch-${candidate}`}
          className={`chip${candidate === locale ? " active" : ""}`}
          href={`/${candidate}`}
        >
          {LOCALE_LABELS[candidate]}
        </a>
      ))}
    </div>
  )
}
