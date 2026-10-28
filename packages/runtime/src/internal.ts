/**
 * Generated-code plumbing for Palamedes adapters and plugins.
 *
 * `@palamedes/runtime/internal` is an Internal surface (see the stability
 * table): generated catalog modules and framework adapters import it, and its
 * exports change together with the generators. Applications use the public
 * `@palamedes/runtime` root instead.
 *
 * @packageDocumentation
 */
import {
  assertCanLoadMessages,
  CLIENT_I18N_KEY,
  createRegisteredMessageLoaderState,
  getRegisteredMessageLoaderGroups,
  getRegisteredMessageLoaders,
  getRegisteredMessages,
  globalRuntimeState,
  type I18nInstance,
  installClientI18n,
  isServerEnvironment,
  loadMessages,
  REGISTERED_MESSAGES_KEY,
  type RegisteredMessageLoader,
  type RegisteredMessageLoaderGroup,
  type RegisteredMessageLoaderState,
  type RegisteredMessages,
} from "./state";

export type { RegisteredMessageLoader, RegisteredMessages };

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
  const state = globalRuntimeState();
  const registered = getRegisteredMessages(state);
  for (const [locale, messages] of Object.entries(catalogs)) {
    const existing = registered.get(locale);
    if (!existing) {
      registered.set(locale, [{ key, messages }]);
      continue;
    }

    const previous = key === undefined ? -1 : existing.findIndex((entry) => entry.key === key);
    if (previous === -1) {
      existing.push({ key, messages });
    } else {
      existing[previous] = { key, messages };
    }
  }

  const active = state[CLIENT_I18N_KEY];
  if (active) {
    assertCanLoadMessages(active, "active client");
    for (const [locale, messages] of Object.entries(catalogs)) {
      loadMessages(active, locale, messages);
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
  loaders: Record<string, RegisteredMessageLoader>,
): () => void {
  const registered = getRegisteredMessageLoaders();
  const registration = createRegisteredMessageLoaderState(loaders);
  registered.set(key, registration);
  return () => {
    if (registered.get(key) === registration) {
      registered.delete(key);
    }
  };
}

/**
 * Replace every lazy sidecar registration owned by a generated source module.
 * The returned release function only removes this exact registration, so an
 * old HMR module cannot unregister the replacement that evaluated after it.
 */
export function registerMessageLoaderGroup(
  key: string,
  loaderGroups: ReadonlyArray<Record<string, RegisteredMessageLoader>>,
): () => void {
  const registered = getRegisteredMessageLoaders();
  const groups = getRegisteredMessageLoaderGroups();
  const previous = groups.get(key);
  if (previous) {
    for (const [registrationKey, registration] of previous.registrations) {
      if (registered.get(registrationKey) === registration) {
        registered.delete(registrationKey);
      }
    }
  }

  if (loaderGroups.length === 0) {
    groups.delete(key);
    return () => {};
  }

  const group: RegisteredMessageLoaderGroup = { registrations: new Map() };
  groups.set(key, group);
  for (const [index, loaders] of loaderGroups.entries()) {
    const registrationKey = `${key}:${index}`;
    const registration = createRegisteredMessageLoaderState(loaders);
    group.registrations.set(registrationKey, registration);
    registered.set(registrationKey, registration);
  }

  return () => {
    if (groups.get(key) !== group) {
      return;
    }
    groups.delete(key);
    for (const [registrationKey, registration] of group.registrations) {
      if (registered.get(registrationKey) === registration) {
        registered.delete(registrationKey);
      }
    }
  };
}

/**
 * Load every message fragment currently present in the server module graph for
 * `locale` into a request-local i18n instance. Resources are deduplicated
 * across concurrent and later requests; loading into the instance remains
 * additive and preserves each generated compiled-catalog object as-is.
 */
export async function loadRegisteredMessages<T extends I18nInstance>(
  i18n: T,
  locale: string,
): Promise<T> {
  const registered = globalRuntimeState()[REGISTERED_MESSAGES_KEY];
  const eagerEntries = registered?.get(locale) ?? [];
  const pending: { state: RegisteredMessageLoaderState; loader: RegisteredMessageLoader }[] = [];

  for (const state of getRegisteredMessageLoaders().values()) {
    const loader = state.loaders[locale];
    if (!loader) {
      continue;
    }
    pending.push({ state, loader });
  }

  if (eagerEntries.length === 0 && pending.length === 0) {
    return i18n;
  }
  // Rejected before any loader starts: a resource created here is cached and
  // awaited below, so throwing afterwards would leave its rejection unhandled.
  assertCanLoadMessages(i18n, "active");

  const lazyResources = pending.map(({ state, loader }) => {
    const existing = state.resources.get(locale);
    if (existing) {
      return existing;
    }

    const resource = loader().catch((error: unknown) => {
      state.resources.delete(locale);
      throw error;
    });
    state.resources.set(locale, resource);
    return resource;
  });

  const lazyMessages = await Promise.all(lazyResources);
  for (const entry of eagerEntries) {
    loadMessages(i18n, locale, entry.messages);
  }
  for (const messages of lazyMessages) {
    loadMessages(i18n, locale, messages);
  }

  return i18n;
}

/**
 * Create the shared parser-free client instance used by graph-split modules.
 * Multiple modules can bootstrap concurrently; the first one installs the
 * instance and every later module reuses it before loading its own fragment.
 */
export function initializeClientI18n<T extends I18nInstance>(
  locale: string,
  createI18n: () => T,
): T {
  if (isServerEnvironment()) {
    throw new Error("Palamedes client graph bootstrap can only run in a browser environment.");
  }

  const active = globalRuntimeState()[CLIENT_I18N_KEY] as T | undefined;
  if (active) {
    if (active.locale !== locale) {
      throw new Error(
        `Palamedes client graph bootstrap requested locale "${locale}", but this client runtime was initialized for "${active.locale}". Perform a navigation or restart the worker to change locale.`,
      );
    }
    assertCanLoadMessages(active, "active client");
    return active;
  }

  const i18n = createI18n();
  i18n.activate(locale);
  return installClientI18n(i18n);
}
