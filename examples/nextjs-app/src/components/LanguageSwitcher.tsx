"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setLocaleAction } from "@/lib/actions"
import { LOCALE_LABELS, type Locale } from "@/lib/i18n"

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
  const [activeLocale, setActiveLocale] = useState(locale)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleLocaleChange(newLocale: Locale) {
    startTransition(async () => {
      setActiveLocale(newLocale)
      await setLocaleAction(newLocale)
      router.refresh()
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
            background: activeLocale === loc ? "#0066cc" : "#eee",
            color: activeLocale === loc ? "white" : "black",
          }}
        >
          {LOCALE_LABELS[loc] ?? loc}
        </button>
      ))}
    </div>
  )
}
