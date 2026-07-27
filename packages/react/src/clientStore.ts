import {
  getClientI18nSnapshot,
  subscribeClientI18n,
  type ClientI18nSnapshot,
} from "@palamedes/runtime"

/*
 * `useSyncExternalStore` calls `subscribe` once per mount and holds on to the
 * returned unsubscribe; it never re-subscribes while the subscribe function
 * keeps its identity. `resetI18nRuntime()` throws the runtime's shared listener
 * Set away, which silently orphans those registrations: the mounted tree then
 * never hears about any later `setClientI18n()` call and stays stale forever.
 *
 * So React keeps its own listener registry here — module state that a runtime
 * reset does not touch — and attaches a single bridge callback to whichever
 * listener Set the runtime currently owns. The bridge is (re-)attached on every
 * subscribe and on every snapshot read, which is the React equivalent of the
 * Solid binding re-subscribing on every reactive read: any render after a reset
 * reconnects the whole tree, not just the component that rendered.
 */
const storeListeners = new Set<() => void>()

function notifyStoreListeners(): void {
  // Deleting entries while iterating a Set is safe, so a listener unsubscribing
  // itself during a locale switch cannot skip the others.
  for (const listener of storeListeners) {
    listener()
  }
}

function connectToRuntime(): void {
  // The runtime keeps listeners in a Set, so re-registering this stable
  // callback is idempotent.
  subscribeClientI18n(notifyStoreListeners)
}

export function subscribeReactiveI18n(onStoreChange: () => void): () => void {
  storeListeners.add(onStoreChange)
  connectToRuntime()

  return () => {
    storeListeners.delete(onStoreChange)
  }
}

export function getReactiveI18nSnapshot(): ClientI18nSnapshot {
  connectToRuntime()
  return getClientI18nSnapshot()
}

const SERVER_CLIENT_I18N_SNAPSHOT: ClientI18nSnapshot = {
  i18n: undefined,
  revision: 0,
}

export function getServerI18nSnapshot(): ClientI18nSnapshot {
  return SERVER_CLIENT_I18N_SNAPSHOT
}
