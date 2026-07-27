import { useEffect, useSyncExternalStore } from "react"

import {
  getReactiveI18nSnapshot,
  getServerI18nSnapshot,
  subscribeReactiveI18n,
} from "./clientStore"

export function useClientLocale<TLocale>(
  locale: TLocale,
  sync: (locale: TLocale) => unknown
): void {
  useSyncExternalStore(subscribeReactiveI18n, getReactiveI18nSnapshot, getServerI18nSnapshot)

  useEffect(() => {
    void sync(locale)
  }, [locale, sync])
}
