import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "~/lib/i18n"
import { LOCALES, LOCALE_LABELS, locales } from "~/lib/i18n"

type LocaleSwitcherProps = {
  host: string | null
  locale: Locale
}

export function LocaleSwitcher({ host, locale }: LocaleSwitcherProps) {
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  // TLD strategy: switching the locale means loading a different host, so we
  // build the target URL from the request host (the core control swaps the
  // rightmost label / Top-Level-Domain) and let the browser do a full document
  // load. Stripping the scheme yields a protocol-relative URL that stays
  // correct on both http (local) and https (deployed).
  function hrefFor(target: Locale): string {
    const url = locales.canonicalUrl({ locale: target, pathname: "/", requestHost: host })
    return url.replace(/^https?:/, "")
  }

  return (
    <div className="switcher">
      <span className="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div className="seg" role="group" aria-label="Language">
        {items.map((item) => (
          <a
            key={item.locale}
            data-testid={item.testId}
            aria-current={item.active ? "page" : undefined}
            href={hrefFor(item.locale)}
            onClick={() => {
              document.cookie = locales.serializeChoice(item.locale)
            }}
          >
            {item.locale.toUpperCase()}
          </a>
        ))}
      </div>
    </div>
  )
}
