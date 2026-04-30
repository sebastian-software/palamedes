"use client"

import type { ReactNode } from "react"

import { useClientLocale } from "@palamedes/react/client"

import type { Locale } from "@/lib/i18n"
import { syncClientI18n } from "@/lib/i18n.client"

interface ClientLocaleBoundaryProps {
  children: ReactNode
  locale: Locale
}

export function ClientLocaleBoundary({ children, locale }: ClientLocaleBoundaryProps) {
  useClientLocale(locale, syncClientI18n)
  return <>{children}</>
}
