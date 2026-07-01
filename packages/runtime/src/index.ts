export type I18nInstance = {
  _: (...args: any[]) => unknown
  locale?: string
}

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined

const CLIENT_I18N_KEY = Symbol.for("palamedes.runtime.clientI18n")

let clientI18n: I18nInstance | undefined
let serverI18nGetter: ServerI18nGetter | undefined

type ClientI18nListener = (i18n: I18nInstance) => void

const clientI18nListeners = new Set<ClientI18nListener>()

function globalClientState(): typeof globalThis & { [CLIENT_I18N_KEY]?: I18nInstance } {
  return globalThis as typeof globalThis & { [CLIENT_I18N_KEY]?: I18nInstance }
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined"
}

export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  clientI18n = i18n
  globalClientState()[CLIENT_I18N_KEY] = i18n
  for (const listener of clientI18nListeners) {
    listener(i18n)
  }
  return i18n
}

/**
 * Subscribe to `setClientI18n` calls. Framework bindings use this to bridge the
 * framework-agnostic client i18n into their own reactivity system (e.g. a Solid
 * signal), so components re-render when the active locale changes on the client.
 *
 * The listener also fires when the same instance is re-activated in place, since
 * `setClientI18n` is expected to be called on every locale switch.
 *
 * Returns an unsubscribe function.
 */
export function subscribeClientI18n(listener: ClientI18nListener): () => void {
  clientI18nListeners.add(listener)
  return () => {
    clientI18nListeners.delete(listener)
  }
}

export function setServerI18nGetter<T extends I18nInstance>(getter: ServerI18nGetter<T>): void {
  serverI18nGetter = getter as ServerI18nGetter
}

export function getI18n<T extends I18nInstance = I18nInstance>(): T {
  if (isServerEnvironment()) {
    const i18n = serverI18nGetter?.()
    if (!i18n) {
      throw new Error(
        "No active server i18n instance. Configure @palamedes/runtime with setServerI18nGetter() before translated code runs."
      )
    }
    return i18n as T
  }

  const activeClientI18n = globalClientState()[CLIENT_I18N_KEY] ?? clientI18n
  if (!activeClientI18n) {
    throw new Error(
      "No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs."
    )
  }

  return activeClientI18n as T
}

export function resetI18nRuntime(): void {
  clientI18n = undefined
  serverI18nGetter = undefined
  delete globalClientState()[CLIENT_I18N_KEY]
}
