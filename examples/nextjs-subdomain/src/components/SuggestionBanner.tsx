"use client"

import { useState } from "react"
import { type Locale, locales } from "@/lib/i18n"

type SuggestionBannerProps = {
  ctaLabel: string
  currentLocale: Locale
  description: string
  recommendedLocale: Locale
  recommendedUrl: string
}

export function SuggestionBanner(props: SuggestionBannerProps) {
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
        href={props.recommendedUrl.replace(/^https?:/, "")}
        onClick={() => {
          document.cookie = locales.serializeChoice(props.recommendedLocale)
        }}
      >
        {props.ctaLabel}
      </a>
      <button
        aria-label="Dismiss"
        className="notice-dismiss"
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
  )
}
