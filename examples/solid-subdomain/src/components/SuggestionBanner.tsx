import { createSignal, Show } from "solid-js"
import { Trans } from "@palamedes/solid/macro"
import { type Locale, locales } from "../lib/i18n"

type SuggestionBannerProps = {
  currentLocale: Locale
  description: string
  recommendedLocale: Locale
  recommendedUrl: string
}

export function SuggestionBanner(props: SuggestionBannerProps) {
  const [dismissed, setDismissed] = createSignal(false)

  return (
    <Show when={!dismissed()}>
      <div class="notice" role="status">
        <span class="notice-text">{props.description}</span>
        <a
          class="notice-cta"
          data-testid="locale-suggestion-cta"
          href={props.recommendedUrl}
          onClick={() => {
            document.cookie = locales.serializeChoice(props.recommendedLocale)
          }}
        >
          <Trans>Switch to the recommended locale</Trans>
        </a>
        <button
          aria-label="Dismiss"
          class="notice-dismiss"
          data-testid="locale-suggestion-dismiss"
          onClick={() => {
            document.cookie = locales.serializeChoice(props.currentLocale)
            setDismissed(true)
          }}
          type="button"
        >
          ×
        </button>
      </div>
    </Show>
  )
}
