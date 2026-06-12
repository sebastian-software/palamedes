import { createEffect } from "solid-js"
import type { Accessor } from "solid-js"

export function createClientLocaleEffect<TLocale>(
  localeAccessor: Accessor<TLocale>,
  sync: (locale: TLocale) => unknown
): void {
  let lastLocale = localeAccessor()
  void sync(lastLocale)

  createEffect(() => {
    const nextLocale = localeAccessor()
    if (Object.is(nextLocale, lastLocale)) {
      return
    }

    lastLocale = nextLocale
    void sync(nextLocale)
  })
}
