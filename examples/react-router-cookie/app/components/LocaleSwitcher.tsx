import { useFetcher } from "react-router"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "~/lib/i18n"
import { LOCALES, LOCALE_LABELS } from "~/lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const fetcher = useFetcher()
  const isPending = fetcher.state !== "idle"
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(nextLocale: Locale) {
    fetcher.submit({ intent: "set-locale", locale: nextLocale }, { method: "post" })
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
            disabled={isPending}
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
