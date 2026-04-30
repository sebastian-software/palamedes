"use client"

import { buildLocaleSwitchItems } from "@palamedes/react"
import { LOCALE_COOKIE, LOCALE_LABELS, type Locale } from "@/lib/i18n"

const buttonStyle = {
  padding: "0.5rem 1rem",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
}

interface LanguageSwitcherProps {
  locale: Locale
  locales: readonly Locale[]
}

export function LanguageSwitcher({ locale, locales }: LanguageSwitcherProps) {
  const localeSwitchItems = buildLocaleSwitchItems({
    locales,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  function handleLocaleChange(newLocale: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    window.location.assign("/")
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      {localeSwitchItems.map((item) => (
        <button
          key={item.locale}
          data-testid={item.testId}
          onClick={() => handleLocaleChange(item.locale)}
          style={{
            ...buttonStyle,
            background: item.active ? "#0066cc" : "#eee",
            color: item.active ? "white" : "black",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
