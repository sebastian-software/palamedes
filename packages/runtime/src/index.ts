export type I18nInstance = {
  _: (...args: any[]) => unknown
  locale: string
}

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined

const CLIENT_I18N_KEY = Symbol.for("palamedes.runtime.clientI18n")
const CLIENT_I18N_SNAPSHOT_KEY = Symbol.for("palamedes.runtime.clientI18nSnapshot")
const CLIENT_I18N_LISTENERS_KEY = Symbol.for("palamedes.runtime.clientI18nListeners")
const SERVER_I18N_GETTER_KEY = Symbol.for("palamedes.runtime.serverI18nGetter")
const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState")

type ClientI18nListener = (i18n: I18nInstance) => void

export type ClientI18nSnapshot = Readonly<{
  i18n: I18nInstance | undefined
  revision: number
}>

export type ServerI18nScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(i18n: T, callback: () => Result): Result
  activate(i18n: T): T
  get(): T | undefined
}

type GlobalRuntimeState = typeof globalThis & {
  [CLIENT_I18N_KEY]?: I18nInstance
  [CLIENT_I18N_SNAPSHOT_KEY]?: ClientI18nSnapshot
  [CLIENT_I18N_LISTENERS_KEY]?: Set<ClientI18nListener>
  [SERVER_I18N_GETTER_KEY]?: ServerI18nGetter
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

function getClientI18nListeners(state = globalRuntimeState()): Set<ClientI18nListener> {
  const existing = state[CLIENT_I18N_LISTENERS_KEY]
  if (existing) {
    return existing
  }

  const listeners = new Set<ClientI18nListener>()
  state[CLIENT_I18N_LISTENERS_KEY] = listeners
  return listeners
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined"
}

export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState()
  const previousSnapshot = getClientI18nSnapshot()
  const nextSnapshot: ClientI18nSnapshot = {
    i18n,
    revision: previousSnapshot.revision + 1,
  }
  state[CLIENT_I18N_KEY] = i18n
  state[CLIENT_I18N_SNAPSHOT_KEY] = nextSnapshot
  for (const listener of getClientI18nListeners(state)) {
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
  const state = globalRuntimeState()
  const existing = state[CLIENT_I18N_SNAPSHOT_KEY]
  if (existing) {
    return existing
  }

  const snapshot: ClientI18nSnapshot = {
    i18n: undefined,
    revision: 0,
  }
  state[CLIENT_I18N_SNAPSHOT_KEY] = snapshot
  return snapshot
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
  const listeners = getClientI18nListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setServerI18nGetter<T extends I18nInstance>(getter: ServerI18nGetter<T>): void {
  globalRuntimeState()[SERVER_I18N_GETTER_KEY] = getter as ServerI18nGetter
}

/**
 * Enter the request scope created by `@palamedes/runtime/server` from an
 * isomorphic SSR bundle that cannot import the Node-only server subpath.
 */
export function activateServerI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState()
  const scopeState = state[SERVER_SCOPE_STATE_KEY]
  if (!scopeState) {
    throw new Error(
      "No server i18n scope is configured. Create one with createServerI18nScope() from @palamedes/runtime/server before activating SSR client components."
    )
  }
  state[SERVER_I18N_GETTER_KEY] ??= () => scopeState.active.getStore()
  const activeI18n = scopeState.active.getStore()
  if (activeI18n === i18n) {
    return i18n
  }
  scopeState.active.enterWith(i18n)
  return i18n
}

export function getI18n<T extends I18nInstance = I18nInstance>(): T {
  if (isServerEnvironment()) {
    const state = globalRuntimeState()
    const i18n =
      state[SERVER_I18N_GETTER_KEY]?.() ?? state[SERVER_SCOPE_STATE_KEY]?.active.getStore()
    if (!i18n) {
      throw new Error(
        "No active server i18n instance. Configure @palamedes/runtime with setServerI18nGetter() before translated code runs."
      )
    }
    return i18n as T
  }

  const activeClientI18n = globalRuntimeState()[CLIENT_I18N_KEY]
  if (!activeClientI18n) {
    throw new Error(
      "No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs."
    )
  }

  return activeClientI18n as T
}

export function resetI18nRuntime(): void {
  const state = globalRuntimeState()
  delete state[CLIENT_I18N_KEY]
  delete state[CLIENT_I18N_SNAPSHOT_KEY]
  delete state[CLIENT_I18N_LISTENERS_KEY]
  delete state[SERVER_I18N_GETTER_KEY]
}
