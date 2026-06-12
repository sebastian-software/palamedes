import { createSignal, For } from "solid-js"
import { buildLocaleSwitchItems } from "@palamedes/solid"
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
    <div class="button-row">
      <For each={localeSwitchItems()}>
        {(item) => (
          <button
            data-testid={item.testId}
            class={`chip${item.active ? " active" : ""}`}
            disabled={isPending()}
            onClick={() => handleLocaleChange(item.locale)}
            type="button"
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  )
}
