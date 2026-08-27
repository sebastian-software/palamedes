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
const REGISTERED_MESSAGE_LOADER_GROUPS_KEY = Symbol.for(
  "palamedes.runtime.registeredMessageLoaderGroups"
)

export type RegisteredMessages = Record<string, Record<string, unknown>>

type MessageLoadingI18n = I18nInstance & {
  load?: (locale: string, messages: Record<string, unknown>) => void
}

type InitializableClientI18n = I18nInstance & {
  activate(locale: string): unknown
  load(locale: string, messages: Record<string, unknown>): unknown
}

/**
 * One buffered eager registration. `key` identifies the registering module, so
 * a module that evaluates again replaces its own entry instead of adding a
 * second copy; keyless registrations always append.
 */
type RegisteredMessageEntry = {
  key?: string
  messages: Record<string, unknown>
}

export type RegisteredMessageLoader = () => Promise<Record<string, unknown>>

type RegisteredMessageLoaderState = {
  loaders: Record<string, RegisteredMessageLoader>
  resources: Map<string, Promise<Record<string, unknown>>>
}

type RegisteredMessageLoaderGroup = {
  registrations: Map<string, RegisteredMessageLoaderState>
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
  [REGISTERED_MESSAGES_KEY]?: Map<string, RegisteredMessageEntry[]>
  [REGISTERED_MESSAGE_LOADERS_KEY]?: Map<string, RegisteredMessageLoaderState>
  [REGISTERED_MESSAGE_LOADER_GROUPS_KEY]?: Map<string, RegisteredMessageLoaderGroup>
}

function globalRuntimeState(): GlobalRuntimeState {
  return globalThis as GlobalRuntimeState
}

type WindowlessClientRuntimeState = GlobalRuntimeState & {
  importScripts?: unknown
  self?: unknown
  WorkerGlobalScope?: unknown
}

function isWindowlessClientEnvironment(): boolean {
  const state = globalRuntimeState() as WindowlessClientRuntimeState
  if (typeof state.importScripts === "function") {
    return true
  }

  const workerGlobalScope = state.WorkerGlobalScope
  return typeof workerGlobalScope === "function" && state.self instanceof workerGlobalScope
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined" && !isWindowlessClientEnvironment()
}

function getActiveServerI18n(state: GlobalRuntimeState): I18nInstance | undefined {
  return state[SERVER_I18N_GETTER_KEY]?.() ?? state[SERVER_SCOPE_STATE_KEY]?.active.getStore()
}

function hasRegisteredServerI18n(state: GlobalRuntimeState): boolean {
  return state[SERVER_I18N_GETTER_KEY] !== undefined || state[SERVER_SCOPE_STATE_KEY] !== undefined
}

function getRegisteredMessages(
  state = globalRuntimeState()
): Map<string, RegisteredMessageEntry[]> {
  const existing = state[REGISTERED_MESSAGES_KEY]
  if (existing) {
    return existing
  }

  const registered = new Map<string, RegisteredMessageEntry[]>()
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

function getRegisteredMessageLoaderGroups(
  state = globalRuntimeState()
): Map<string, RegisteredMessageLoaderGroup> {
  const existing = state[REGISTERED_MESSAGE_LOADER_GROUPS_KEY]
  if (existing) {
    return existing
  }

  const registered = new Map<string, RegisteredMessageLoaderGroup>()
  state[REGISTERED_MESSAGE_LOADER_GROUPS_KEY] = registered
  return registered
}

function createRegisteredMessageLoaderState(
  loaders: Record<string, RegisteredMessageLoader>
): RegisteredMessageLoaderState {
  return { loaders, resources: new Map() }
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
 * Registrations are module-evaluation facts, not instance state. They survive
 * `resetI18nRuntime()` because the registering modules will not evaluate a
 * second time.
 *
 * `key` is the optional stable identity of the registering module. It is what
 * makes re-evaluation idempotent: dev-server SSR re-runs an invalidated
 * generated module in the same process, and without a key every catalog edit
 * would buffer another full copy and keep serving removed message ids from the
 * older ones. Re-registering a key replaces its entry in place, so buffer size
 * and load order stay stable. Keyless registrations always append.
 */
export function registerMessages(catalogs: RegisteredMessages, key?: string): void {
  const state = globalRuntimeState()
  const registered = getRegisteredMessages(state)
  for (const [locale, messages] of Object.entries(catalogs)) {
    const existing = registered.get(locale)
    if (!existing) {
      registered.set(locale, [{ key, messages }])
      continue
    }

    const previous = key === undefined ? -1 : existing.findIndex((entry) => entry.key === key)
    if (previous === -1) {
      existing.push({ key, messages })
    } else {
      existing[previous] = { key, messages }
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
): () => void {
  const registered = getRegisteredMessageLoaders()
  const registration = createRegisteredMessageLoaderState(loaders)
  registered.set(key, registration)
  return () => {
    if (registered.get(key) === registration) {
      registered.delete(key)
    }
  }
}

/**
 * Replace every lazy sidecar registration owned by a generated source module.
 * The returned release function only removes this exact registration, so an
 * old HMR module cannot unregister the replacement that evaluated after it.
 */
export function registerMessageLoaderGroup(
  key: string,
  loaderGroups: ReadonlyArray<Record<string, RegisteredMessageLoader>>
): () => void {
  const registered = getRegisteredMessageLoaders()
  const groups = getRegisteredMessageLoaderGroups()
  const previous = groups.get(key)
  if (previous) {
    for (const [registrationKey, registration] of previous.registrations) {
      if (registered.get(registrationKey) === registration) {
        registered.delete(registrationKey)
      }
    }
  }

  if (loaderGroups.length === 0) {
    groups.delete(key)
    return () => {}
  }

  const group: RegisteredMessageLoaderGroup = { registrations: new Map() }
  groups.set(key, group)
  for (const [index, loaders] of loaderGroups.entries()) {
    const registrationKey = `${key}:${index}`
    const registration = createRegisteredMessageLoaderState(loaders)
    group.registrations.set(registrationKey, registration)
    registered.set(registrationKey, registration)
  }

  return () => {
    if (groups.get(key) !== group) {
      return
    }
    groups.delete(key)
    for (const [registrationKey, registration] of group.registrations) {
      if (registered.get(registrationKey) === registration) {
        registered.delete(registrationKey)
      }
    }
  }
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
  const eagerEntries = registered?.get(locale) ?? []
  const pending: { state: RegisteredMessageLoaderState; loader: RegisteredMessageLoader }[] = []

  for (const state of getRegisteredMessageLoaders().values()) {
    const loader = state.loaders[locale]
    if (!loader) {
      continue
    }
    pending.push({ state, loader })
  }

  if (eagerEntries.length === 0 && pending.length === 0) {
    return i18n
  }
  // Rejected before any loader starts: a resource created here is cached and
  // awaited below, so throwing afterwards would leave its rejection unhandled.
  if (!loadable.load) {
    throw new TypeError(
      "The active i18n instance cannot load generated graph-split messages. Provide an instance with load(locale, messages)."
    )
  }

  const lazyResources = pending.map(({ state, loader }) => {
    const existing = state.resources.get(locale)
    if (existing) {
      return existing
    }

    const resource = loader().catch((error: unknown) => {
      state.resources.delete(locale)
      throw error
    })
    state.resources.set(locale, resource)
    return resource
  })

  const lazyMessages = await Promise.all(lazyResources)
  for (const entry of eagerEntries) {
    loadable.load(locale, entry.messages)
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
    for (const [locale, entries] of registered) {
      for (const entry of entries) {
        loadable.load(locale, entry.messages)
      }
    }
  }
  state[CLIENT_I18N_KEY] = i18n
  return i18n
}

/**
 * Create the shared parser-free client instance used by graph-split modules.
 * Multiple modules can bootstrap concurrently; the first one installs the
 * instance and every later module reuses it before loading its own fragment.
 */
export function initializeClientI18n<T extends InitializableClientI18n>(
  locale: string,
  createI18n: () => T
): T {
  if (isServerEnvironment()) {
    throw new Error("Palamedes client graph bootstrap can only run in a browser environment.")
  }

  const active = globalRuntimeState()[CLIENT_I18N_KEY] as T | undefined
  if (active) {
    if (active.locale !== locale) {
      throw new Error(
        `Palamedes client graph bootstrap requested locale "${locale}", but this client runtime was initialized for "${active.locale}". Perform a navigation or restart the worker to change locale.`
      )
    }
    if (typeof active.load !== "function") {
      throw new TypeError(
        "The active client i18n instance cannot load generated graph-split messages. Provide an instance with load(locale, messages)."
      )
    }
    return active
  }

  const i18n = createI18n()
  i18n.activate(locale)
  return setClientI18n(i18n)
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
  const state = globalRuntimeState()
  const serverI18n = getActiveServerI18n(state)
  if (serverI18n) {
    return serverI18n as T
  }

  if (isServerEnvironment() || hasRegisteredServerI18n(state)) {
    throw new Error(
      "No active server i18n instance. Configure @palamedes/runtime with setServerI18nGetter() before translated code runs."
    )
  }

  const activeClientI18n = state[CLIENT_I18N_KEY]
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
