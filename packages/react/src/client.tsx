import { useEffect, useSyncExternalStore } from "react"
import {
  getClientI18nSnapshot,
  subscribeClientI18n,
  type ClientI18nSnapshot,
} from "@palamedes/runtime"

const SERVER_CLIENT_I18N_SNAPSHOT: ClientI18nSnapshot = {
  i18n: undefined,
  revision: 0,
}

export function useClientLocale<TLocale>(
  locale: TLocale,
  sync: (locale: TLocale) => unknown
): void {
  useSyncExternalStore(
    subscribeClientI18n,
    getClientI18nSnapshot,
    () => SERVER_CLIENT_I18N_SNAPSHOT
  )

  useEffect(() => {
    void sync(locale)
  }, [locale, sync])
}
