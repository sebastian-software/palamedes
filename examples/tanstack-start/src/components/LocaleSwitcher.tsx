import { useNavigate } from "@tanstack/react-router"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"

interface LocaleSwitcherProps {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const navigate = useNavigate()

  function handleLocaleChange(nextLocale: Locale) {
    void navigate({
      to: "/",
      search: { locale: nextLocale },
    })
  }

  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <button
          key={candidate}
          className={`chip${candidate === locale ? " active" : ""}`}
          onClick={() => handleLocaleChange(candidate)}
          type="button"
        >
          {LOCALE_LABELS[candidate]}
        </button>
      ))}
    </div>
  )
}
