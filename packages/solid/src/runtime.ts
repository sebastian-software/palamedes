import { createSignal } from "solid-js"

import type { I18nInstance } from "@palamedes/runtime"
import { getI18n as getRuntimeI18n, subscribeClientI18n } from "@palamedes/runtime"

// The active client i18n instance lives in the framework-agnostic runtime, so it
// cannot notify Solid on its own. We bridge `setClientI18n` calls into a Solid
// signal here: reading `trackClientI18n()` inside a reactive computation makes it
// a dependency, and every locale switch (which re-calls `setClientI18n`) bumps
// the signal, re-running any translation output that depends on it.
//
// `equals: false` is required because the client typically re-activates the same
// i18n instance in place — only its internal locale changes — so identity-based
// change detection would never fire.
const [trackClientI18n, notifyClientI18n] = createSignal(undefined, { equals: false })

// Subscribe lazily on use rather than at module load: this package sets
// `sideEffects: false`, so a top-level subscription could be dropped by a bundler
// that considers it dead code. The runtime stores listeners in a Set, making
// repeated registration of this stable callback idempotent. Registering on every
// read also reconnects the bridge after resetI18nRuntime clears shared listeners.
const notifyClientLocaleChanged = () => {
  notifyClientI18n()
}

function ensureSubscribed(): void {
  subscribeClientI18n(notifyClientLocaleChanged)
}

/**
 * Reactive replacement for `@palamedes/runtime`'s `getI18n`.
 *
 * Reading this inside a Solid reactive scope (a component's returned accessor, a
 * memo, or the thunks the macro transform emits for `t`/`plural`) subscribes that
 * scope to client locale switches, so the output re-renders in the new locale.
 *
 * Wire it up by pointing the Palamedes transform at this module:
 * `palamedes({ runtimeModule: "@palamedes/solid/runtime" })`.
 */
export function getI18n<T extends I18nInstance = I18nInstance>(): T {
  ensureSubscribed()
  trackClientI18n()
  return getRuntimeI18n<T>()
}
