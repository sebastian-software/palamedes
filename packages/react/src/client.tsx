import { useEffect, useRef, useSyncExternalStore } from "react"
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
  const snapshot = useSyncExternalStore(
    subscribeClientI18n,
    getClientI18nSnapshot,
    () => SERVER_CLIENT_I18N_SNAPSHOT
  )
  const renderSync = useRef<{ locale: TLocale; sync: typeof sync } | null>(null)

  // Backward-compatible bootstrap for apps that have not initialized their
  // client runtime before hydration. This branch never runs during SSR. New
  // integrations should initialize before hydration, as the Next.js examples
  // do, so all synchronization happens after commit.
  if (typeof window !== "undefined" && !snapshot.i18n) {
    renderSync.current = { locale, sync }
    void sync(locale)
  }

  useEffect(() => {
    const synchronousBootstrap = renderSync.current
    renderSync.current = null
    if (
      synchronousBootstrap &&
      synchronousBootstrap.sync === sync &&
      Object.is(synchronousBootstrap.locale, locale)
    ) {
      return
    }

    void sync(locale)
  }, [locale, sync])
}
