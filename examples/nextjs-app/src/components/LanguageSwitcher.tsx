"use client"

import { useTransition } from "react"
import { useLocale } from "./I18nClientProvider"
import { setLocaleAction } from "@/lib/actions"
import type { Locale } from "@/lib/i18n"

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
}

const buttonStyle = {
  padding: "0.5rem 1rem",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
}

export function LanguageSwitcher() {
  const { locale, setLocale, locales } = useLocale()
  const [isPending, startTransition] = useTransition()

  function handleLocaleChange(newLocale: Locale) {
    startTransition(async () => {
      // Update client-side state immediately
      setLocale(newLocale)
      // Server Action: set cookie + revalidate
      await setLocaleAction(newLocale)
    })
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", opacity: isPending ? 0.7 : 1 }}>
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => handleLocaleChange(loc)}
          disabled={isPending}
          style={{
            ...buttonStyle,
            background: locale === loc ? "#0066cc" : "#eee",
            color: locale === loc ? "white" : "black",
          }}
        >
          {LOCALE_NAMES[loc] ?? loc}
        </button>
      ))}
    </div>
  )
}
