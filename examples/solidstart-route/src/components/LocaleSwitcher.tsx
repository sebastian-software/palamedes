import { For } from "solid-js"
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

interface LocaleSwitcherProps {
  locale: Locale
}

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  return (
    <div class="button-row">
      <For each={LOCALES}>
        {(candidate) => (
          <a
            data-testid={`locale-switch-${candidate}`}
            class={`chip${candidate === props.locale ? " active" : ""}`}
            href={`/${candidate}`}
          >
            {LOCALE_LABELS[candidate]}
          </a>
        )}
      </For>
    </div>
  )
}
