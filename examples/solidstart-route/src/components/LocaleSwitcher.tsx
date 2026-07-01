import { For } from "solid-js"
import { A } from "@solidjs/router"
import { buildLocaleSwitchItems } from "@palamedes/solid"
import { Trans } from "@palamedes/solid/macro"
import { LOCALES, LOCALE_LABELS, type Locale, locales } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  const localeSwitchItems = () =>
    buildLocaleSwitchItems({
      locales: LOCALES,
      currentLocale: props.locale,
      labels: LOCALE_LABELS,
    })

  return (
    <div class="switcher">
      <span class="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div class="seg" role="group" aria-label="Language">
        <For each={localeSwitchItems()}>
          {(item) => (
            <A
              data-testid={item.testId}
              aria-current={item.active ? "page" : undefined}
              href={`/${item.locale}`}
              onClick={() => {
                document.cookie = locales.serializeChoice(item.locale)
              }}
            >
              {item.locale.toUpperCase()}
            </A>
          )}
        </For>
      </div>
    </div>
  )
}
