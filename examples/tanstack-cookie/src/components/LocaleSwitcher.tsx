import { useTransition } from "react"
import { buildLocaleSwitchItems } from "@palamedes/react"
import type { Locale } from "../lib/i18n"
import { LOCALES, LOCALE_LABELS } from "../lib/i18n"
import { setLocaleCookie } from "../lib/server-functions"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition()
  const localeSwitchItems = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(nextLocale: Locale) {
    startTransition(async () => {
      await setLocaleCookie({ data: { locale: nextLocale } })
      window.location.assign("/")
    })
  }

  return (
    <div className="button-row">
      {localeSwitchItems.map((item) => (
        <button
          key={item.locale}
          data-testid={item.testId}
          className={`chip${item.active ? " active" : ""}`}
          disabled={isPending}
          onClick={() => handleLocaleChange(item.locale)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
