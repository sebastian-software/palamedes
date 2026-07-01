"use client"

import { useTransition } from "react"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "@/lib/i18n"
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n"
import { setLocaleAction } from "@/lib/actions"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition()
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(nextLocale: Locale) {
    startTransition(async () => {
      await setLocaleAction(nextLocale)
    })
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
