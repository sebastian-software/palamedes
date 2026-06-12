import { For } from "solid-js"
import { buildLocaleSwitchItems } from "@palamedes/solid"
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

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
    <div class="button-row">
      <For each={localeSwitchItems()}>
        {(item) => (
          <a
            data-testid={item.testId}
            class={`chip${item.active ? " active" : ""}`}
            href={`/${item.locale}`}
          >
            {item.label}
          </a>
        )}
      </For>
    </div>
  )
}
