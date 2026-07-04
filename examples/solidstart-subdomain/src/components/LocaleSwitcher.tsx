import { For } from "solid-js"
import { buildLocaleSwitchItems } from "@palamedes/solid"
import { Trans } from "@palamedes/solid/macro"
import { LOCALES, LOCALE_LABELS, type Locale, locales } from "../lib/i18n"

type LocaleSwitcherProps = {
  host: string | null
  locale: Locale
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  const localeSwitchItems = () =>
    buildLocaleSwitchItems({
      locales: LOCALES,
      currentLocale: props.locale,
      labels: LOCALE_LABELS,
    })

  // Subdomain strategy: switching the locale means loading a different host, so
  // we build the target URL from the request host (the core control swaps the
  // leftmost label) and let the browser do a full document load. Stripping the
  // scheme yields a protocol-relative URL that stays correct on both http
  // (local) and https (deployed).
  function hrefFor(target: Locale): string {
    const url = locales.canonicalUrl({ locale: target, pathname: "/", requestHost: props.host })
    return url.replace(/^https?:/, "")
  }

  return (
    <div class="switcher">
      <span class="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div class="seg" role="group" aria-label="Language">
        <For each={localeSwitchItems()}>
          {(item) => (
            <a
              data-testid={item.testId}
              aria-current={item.active ? "page" : undefined}
              href={hrefFor(item.locale)}
              onClick={() => {
                document.cookie = locales.serializeChoice(item.locale)
              }}
            >
              {item.locale.toUpperCase()}
            </a>
          )}
        </For>
      </div>
    </div>
  )
}
