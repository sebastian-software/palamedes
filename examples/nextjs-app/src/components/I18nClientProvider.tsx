"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"
import { i18n } from "@lingui/core"
import { I18nProvider } from "@lingui/react"
import { setClientI18n } from "@palamedes/runtime"
import { Locale, LOCALES, loadMessages } from "@/lib/i18n"

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  locales: readonly Locale[]
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error("useLocale must be used within I18nClientProvider")
  }
  return ctx
}

interface Props {
  children: ReactNode
  initialLocale: Locale
}

export function I18nClientProvider({ children, initialLocale }: Props) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [isLoaded, setIsLoaded] = useState(false)

  // Initialize i18n on mount
  useEffect(() => {
    async function init() {
      const messages = await loadMessages(initialLocale)
      i18n.load(initialLocale, messages)
      i18n.activate(initialLocale)
      setClientI18n(i18n)
      setIsLoaded(true)
    }
    init()
  }, [initialLocale])

  // Update client-side i18n when locale changes
  const setLocale = useCallback(async (newLocale: Locale) => {
    const messages = await loadMessages(newLocale)
    i18n.load(newLocale, messages)
    i18n.activate(newLocale)
    setClientI18n(i18n)
    setLocaleState(newLocale)
  }, [])

  if (!isLoaded) {
    return null // Or a loading spinner
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, locales: LOCALES }}>
      <I18nProvider i18n={i18n}>
        {children}
      </I18nProvider>
    </LocaleContext.Provider>
  )
}
