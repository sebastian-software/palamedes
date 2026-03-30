import { createSignal, For } from "solid-js"
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale } from "../lib/i18n"

interface LocaleSwitcherProps {
  locale: Locale
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  const [isPending, setIsPending] = createSignal(false)

  function handleLocaleChange(nextLocale: Locale) {
    setIsPending(true)
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=${60 * 60 * 24 * 365}`
    window.location.assign("/")
  }

  return (
    <div class="button-row">
      <For each={LOCALES}>
        {(candidate) => (
          <button
            data-testid={`locale-switch-${candidate}`}
            class={`chip${candidate === props.locale ? " active" : ""}`}
            disabled={isPending()}
            onClick={() => handleLocaleChange(candidate)}
            type="button"
          >
            {LOCALE_LABELS[candidate]}
          </button>
        )}
      </For>
    </div>
  )
}
