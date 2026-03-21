import { useTransition } from "react"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"
import { setLocaleCookie } from "../lib/server-functions"

interface LocaleSwitcherProps {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition()

  function handleLocaleChange(nextLocale: Locale) {
    startTransition(async () => {
      await setLocaleCookie({ data: { locale: nextLocale } })
      window.location.assign("/")
    })
  }

  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <button
          key={candidate}
          data-testid={`locale-switch-${candidate}`}
          className={`chip${candidate === locale ? " active" : ""}`}
          disabled={isPending}
          onClick={() => handleLocaleChange(candidate)}
          type="button"
        >
          {LOCALE_LABELS[candidate]}
        </button>
      ))}
    </div>
  )
}
