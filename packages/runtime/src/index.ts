export type I18nInstance = {
  _: (...args: any[]) => unknown
  locale?: string
}

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined

const CLIENT_I18N_KEY = Symbol.for("palamedes.runtime.clientI18n")
const CLIENT_I18N_SNAPSHOT_KEY = Symbol.for("palamedes.runtime.clientI18nSnapshot")
const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState")

let clientI18n: I18nInstance | undefined
let clientI18nSnapshot: ClientI18nSnapshot = {
  i18n: undefined,
  revision: 0,
}
let serverI18nGetter: ServerI18nGetter | undefined

type ClientI18nListener = (i18n: I18nInstance) => void

const clientI18nListeners = new Set<ClientI18nListener>()

export type ClientI18nSnapshot = Readonly<{
  i18n: I18nInstance | undefined
  revision: number
}>

type GlobalRuntimeState = typeof globalThis & {
  [CLIENT_I18N_KEY]?: I18nInstance
  [CLIENT_I18N_SNAPSHOT_KEY]?: ClientI18nSnapshot
  [SERVER_SCOPE_STATE_KEY]?: {
    active: {
      enterWith(i18n: I18nInstance): void
      getStore(): I18nInstance | undefined
    }
  }
}

function globalRuntimeState(): GlobalRuntimeState {
  return globalThis as GlobalRuntimeState
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined"
}

export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState()
  const previousSnapshot = state[CLIENT_I18N_SNAPSHOT_KEY] ?? clientI18nSnapshot
  clientI18n = i18n
  clientI18nSnapshot = {
    i18n,
    revision: previousSnapshot.revision + 1,
  }
  state[CLIENT_I18N_KEY] = i18n
  state[CLIENT_I18N_SNAPSHOT_KEY] = clientI18nSnapshot
  for (const listener of clientI18nListeners) {
    listener(i18n)
  }
  return i18n
}

/**
 * Return a stable snapshot of the active client instance and its activation
 * revision. Framework bindings use the revision to observe re-activation of the
 * same mutable i18n instance.
 */
export function getClientI18nSnapshot(): ClientI18nSnapshot {
  return globalRuntimeState()[CLIENT_I18N_SNAPSHOT_KEY] ?? clientI18nSnapshot
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

/**
 * Enter the request scope created by `@palamedes/runtime/server` from an
 * isomorphic SSR bundle that cannot import the Node-only server subpath.
 */
export function activateServerI18n<T extends I18nInstance>(i18n: T): T {
  const scopeState = globalRuntimeState()[SERVER_SCOPE_STATE_KEY]
  if (!scopeState) {
    throw new Error(
      "No server i18n scope is configured. Create one with createServerI18nScope() from @palamedes/runtime/server before activating SSR client components."
    )
  }
  serverI18nGetter = () => scopeState.active.getStore()
  scopeState.active.enterWith(i18n)
  return i18n
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

  const activeClientI18n = globalRuntimeState()[CLIENT_I18N_KEY] ?? clientI18n
  if (!activeClientI18n) {
    throw new Error(
      "No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs."
    )
  }

  return activeClientI18n as T
}

export function resetI18nRuntime(): void {
  clientI18n = undefined
  clientI18nSnapshot = {
    i18n: undefined,
    revision: 0,
  }
  const state = globalRuntimeState()
  delete state[CLIENT_I18N_KEY]
  delete state[CLIENT_I18N_SNAPSHOT_KEY]
  serverI18nGetter = undefined
}
