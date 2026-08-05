export type I18nInstance = {
  _: (...args: any[]) => unknown
  locale: string
}

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined

const CLIENT_I18N_KEY = Symbol.for("palamedes.runtime.clientI18n")
const SERVER_I18N_GETTER_KEY = Symbol.for("palamedes.runtime.serverI18nGetter")
const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState")
const REGISTERED_MESSAGES_KEY = Symbol.for("palamedes.runtime.registeredMessages")
const REGISTERED_MESSAGE_LOADERS_KEY = Symbol.for("palamedes.runtime.registeredMessageLoaders")

export type RegisteredMessages = Record<string, Record<string, unknown>>

type MessageLoadingI18n = I18nInstance & {
  load?: (locale: string, messages: Record<string, unknown>) => void
}

export type RegisteredMessageLoader = () => Promise<Record<string, unknown>>

type RegisteredMessageLoaderState = {
  loaders: Record<string, RegisteredMessageLoader>
  resources: Map<string, Promise<Record<string, unknown>>>
}

export type ServerI18nScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(i18n: T, callback: () => Result): Result
  activate(i18n: T): T
  get(): T | undefined
}

export type CreateServerI18nScopeOptions = {
  /**
   * A framework adapter's stable request/render identity. The provider ID
   * replaces an earlier registration from the same adapter during dev HMR.
   */
  requestKeyProvider?: {
    get(): object | undefined
    id: symbol
  }
}

type GlobalRuntimeState = typeof globalThis & {
  [CLIENT_I18N_KEY]?: I18nInstance
  [SERVER_I18N_GETTER_KEY]?: ServerI18nGetter
  [SERVER_SCOPE_STATE_KEY]?: {
    active: {
      enterWith(i18n: I18nInstance): void
      getStore(): I18nInstance | undefined
    }
    activate(i18n: I18nInstance): void
    get(): I18nInstance | undefined
  }
  [REGISTERED_MESSAGES_KEY]?: Map<string, Record<string, unknown>[]>
  [REGISTERED_MESSAGE_LOADERS_KEY]?: Map<string, RegisteredMessageLoaderState>
}

function globalRuntimeState(): GlobalRuntimeState {
  return globalThis as GlobalRuntimeState
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined"
}

function getRegisteredMessages(
  state = globalRuntimeState()
): Map<string, Record<string, unknown>[]> {
  const existing = state[REGISTERED_MESSAGES_KEY]
  if (existing) {
    return existing
  }

  const registered = new Map<string, Record<string, unknown>[]>()
  state[REGISTERED_MESSAGES_KEY] = registered
  return registered
}

function getRegisteredMessageLoaders(
  state = globalRuntimeState()
): Map<string, RegisteredMessageLoaderState> {
  const existing = state[REGISTERED_MESSAGE_LOADERS_KEY]
  if (existing) {
    return existing
  }

  const registered = new Map<string, RegisteredMessageLoaderState>()
  state[REGISTERED_MESSAGE_LOADERS_KEY] = registered
  return registered
}

/**
 * Register compiled messages at module-evaluation time. Generated message
 * sidecar modules (experimental graph splitting) call this so messages travel
 * with the code chunks that use them: registration loads into the active
 * client instance immediately when one is installed, and buffers otherwise so
 * `setClientI18n` can flush before the first render.
 *
 * Each registered map is buffered and loaded as-is, never copied or merged:
 * generated catalogs carry the compiled-catalog brand, and the parser-free
 * runtime rejects unbranded copies. Merging across registrations is the
 * instance's `load()` responsibility.
 *
 * Registrations are module-evaluation facts, not instance state: like the
 * framework bindings' listener stores, they survive `resetI18nRuntime()`,
 * because the registering modules will not evaluate a second time.
 */
export function registerMessages(catalogs: RegisteredMessages): void {
  const state = globalRuntimeState()
  const registered = getRegisteredMessages(state)
  for (const [locale, messages] of Object.entries(catalogs)) {
    const existing = registered.get(locale)
    if (existing) {
      existing.push(messages)
    } else {
      registered.set(locale, [messages])
    }
  }

  const active = state[CLIENT_I18N_KEY] as MessageLoadingI18n | undefined
  if (active?.load) {
    for (const [locale, messages] of Object.entries(catalogs)) {
      active.load(locale, messages)
    }
  }
}

/**
 * Register locale-specific message loaders for one generated source-module
 * sidecar. Server adapters use these lazy resources so the ESM graph
 * determines message membership while each request materializes only its
 * active locale.
 *
 * `key` is stable across rebuilds. Re-registering it replaces the prior
 * loaders and their resources, which keeps development HMR from retaining a
 * stale sidecar forever.
 */
export function registerMessageLoaders(
  key: string,
  loaders: Record<string, RegisteredMessageLoader>
): void {
  getRegisteredMessageLoaders().set(key, {
    loaders,
    resources: new Map(),
  })
}

/**
 * Load every message fragment currently present in the server module graph for
 * `locale` into a request-local i18n instance. Resources are deduplicated
 * across concurrent and later requests; loading into the instance remains
 * additive and preserves each generated compiled-catalog object as-is.
 */
export async function loadRegisteredMessages<T extends I18nInstance>(
  i18n: T,
  locale: string
): Promise<T> {
  const loadable = i18n as MessageLoadingI18n
  const registered = globalRuntimeState()[REGISTERED_MESSAGES_KEY]
  const eagerMessages = registered?.get(locale) ?? []
  const lazyResources: Promise<Record<string, unknown>>[] = []

  for (const state of getRegisteredMessageLoaders().values()) {
    const loader = state.loaders[locale]
    if (!loader) {
      continue
    }

    let resource = state.resources.get(locale)
    if (!resource) {
      resource = loader().catch((error: unknown) => {
        state.resources.delete(locale)
        throw error
      })
      state.resources.set(locale, resource)
    }
    lazyResources.push(resource)
  }

  if (eagerMessages.length === 0 && lazyResources.length === 0) {
    return i18n
  }
  if (!loadable.load) {
    throw new TypeError(
      "The active i18n instance cannot load generated graph-split messages. Provide an instance with load(locale, messages)."
    )
  }

  const lazyMessages = await Promise.all(lazyResources)
  for (const messages of eagerMessages) {
    loadable.load(locale, messages)
  }
  for (const messages of lazyMessages) {
    loadable.load(locale, messages)
  }

  return i18n
}

export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState()
  const registered = state[REGISTERED_MESSAGES_KEY]
  const loadable = i18n as MessageLoadingI18n
  if (registered && loadable.load) {
    for (const [locale, maps] of registered) {
      for (const messages of maps) {
        loadable.load(locale, messages)
      }
    }
  }
  state[CLIENT_I18N_KEY] = i18n
  return i18n
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
  state[SERVER_I18N_GETTER_KEY] ??= () => scopeState.get()
  const activeI18n = scopeState.get()
  if (activeI18n === i18n) {
    return i18n
  }
  scopeState.activate(i18n)
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
  delete state[SERVER_I18N_GETTER_KEY]
}
