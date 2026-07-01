"use client"

import { useState } from "react"
import { serializeChoiceCookie, type Locale } from "@palamedes/example-locale-shared"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { syncClientI18n } from "../lib/i18n"

type SuggestionBannerProps = {
  currentLocale: Locale
  description: string
  recommendedLocale: Locale
  recommendedUrl: string
}

export function SuggestionBanner(props: SuggestionBannerProps) {
  useClientLocale(props.currentLocale, syncClientI18n)
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) {
    return null
  }

  return (
    <div className="notice" role="status">
      <span className="notice-text">{props.description}</span>
      <a
        className="notice-cta"
        data-testid="locale-suggestion-cta"
        href={props.recommendedUrl}
        onClick={() => {
          document.cookie = serializeChoiceCookie(props.recommendedLocale)
        }}
      >
        <Trans>Switch to the recommended locale</Trans>
      </a>
      <button
        aria-label="Dismiss"
        className="notice-dismiss"
        data-testid="locale-suggestion-dismiss"
        onClick={() => {
          document.cookie = serializeChoiceCookie(props.currentLocale)
          setDismissed(true)
        }}
        type="button"
      >
        ×
      </button>
    </div>
  )
}
