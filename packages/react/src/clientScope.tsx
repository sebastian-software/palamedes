import * as React from "react"
import { createContext, useContext, type ReactNode } from "react"

import type { I18nInstance } from "@palamedes/runtime"

const ClientI18nContext = createContext<I18nInstance | undefined>(undefined)

export function ClientI18nScope({ children, i18n }: { children: ReactNode; i18n: I18nInstance }) {
  return <ClientI18nContext value={i18n}>{children}</ClientI18nContext>
}

export function useScopedClientI18n<T extends I18nInstance>(): T | undefined {
  return useContext(ClientI18nContext) as T | undefined
}
