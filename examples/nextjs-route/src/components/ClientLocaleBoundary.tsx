"use client"

import type { ReactNode } from "react"

import { useClientLocale } from "@palamedes/react/client"

import type { Locale } from "@/lib/i18n"
import { activateServerClientI18n, syncClientI18n } from "@/lib/i18n.client"

type ClientLocaleBoundaryProps = {
  children: ReactNode
  locale: Locale
}

export function ClientLocaleBoundary({ children, locale }: ClientLocaleBoundaryProps) {
  if (typeof window === "undefined") {
    activateServerClientI18n(locale)
  }
  useClientLocale(locale, syncClientI18n)
  const serializedLocale = JSON.stringify(locale).replaceAll("<", "\\u003c")
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__PALAMEDES_LOCALE__=${serializedLocale};`,
        }}
      />
      {children}
    </>
  )
}
