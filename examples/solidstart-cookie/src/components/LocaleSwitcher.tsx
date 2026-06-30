import { createSignal, For } from "solid-js"
import { buildLocaleSwitchItems } from "@palamedes/solid"
import { Trans } from "@palamedes/solid/macro"
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale } from "../lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  const [isPending, setIsPending] = createSignal(false)
  const localeSwitchItems = () =>
    buildLocaleSwitchItems({
      locales: LOCALES,
      currentLocale: props.locale,
      labels: LOCALE_LABELS,
    })

  function handleLocaleChange(nextLocale: Locale) {
    setIsPending(true)
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=${60 * 60 * 24 * 365}`
    window.location.assign("/")
  }

  return (
    <div class="switcher">
      <span class="switcher-label">
        <Trans>Locale</Trans>
      </span>
      <div class="seg" role="group" aria-label="Language">
        <For each={localeSwitchItems()}>
          {(item) => (
            <button
              data-testid={item.testId}
              aria-pressed={item.active}
              disabled={isPending()}
              onClick={() => handleLocaleChange(item.locale)}
              type="button"
            >
              {item.locale.toUpperCase()}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
