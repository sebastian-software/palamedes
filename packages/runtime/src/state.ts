import type { CompiledCatalogMessages, PalamedesI18n } from "@palamedes/core";

// Shared runtime state for the public root and the generated-code-only
// `@palamedes/runtime/internal` entry. Every value lives on `globalThis` under
// a `Symbol.for` key, so separately bundled copies of either entry still see
// one registry and one active client instance.

/**
 * The i18n instance shape every adapter, generated module and `getI18n()`
 * consumer relies on. It is core's `PalamedesI18n`: `_()` returns text, and
 * `load`, `activate`, `renderMessage` and `locale` are required.
 */
export type I18nInstance = PalamedesI18n;

type ServerI18nGetter = () => I18nInstance | undefined;

export const CLIENT_I18N_KEY = Symbol.for("palamedes.runtime.clientI18n");
export const SERVER_I18N_GETTER_KEY = Symbol.for("palamedes.runtime.serverI18nGetter");
export const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState");
export const REGISTERED_MESSAGES_KEY = Symbol.for("palamedes.runtime.registeredMessages");
export const REGISTERED_MESSAGE_LOADERS_KEY = Symbol.for(
  "palamedes.runtime.registeredMessageLoaders",
);
export const REGISTERED_MESSAGE_LOADER_GROUPS_KEY = Symbol.for(
  "palamedes.runtime.registeredMessageLoaderGroups",
);

export type RegisteredMessages = Record<string, Record<string, unknown>>;

/**
 * One buffered eager registration. `key` identifies the registering module, so
 * a module that evaluates again replaces its own entry instead of adding a
 * second copy; keyless registrations always append.
 */
export type RegisteredMessageEntry = {
  key?: string;
  messages: Record<string, unknown>;
};

export type RegisteredMessageLoader = () => Promise<Record<string, unknown>>;

export type RegisteredMessageLoaderState = {
  loaders: Record<string, RegisteredMessageLoader>;
  resources: Map<string, Promise<Record<string, unknown>>>;
};

export type RegisteredMessageLoaderGroup = {
  registrations: Map<string, RegisteredMessageLoaderState>;
};

export type GlobalRuntimeState = typeof globalThis & {
  [CLIENT_I18N_KEY]?: I18nInstance;
  [SERVER_I18N_GETTER_KEY]?: ServerI18nGetter;
  [SERVER_SCOPE_STATE_KEY]?: {
    active: {
      enterWith(i18n: I18nInstance): void;
      getStore(): I18nInstance | undefined;
    };
    activate(i18n: I18nInstance): void;
    get(): I18nInstance | undefined;
  };
  [REGISTERED_MESSAGES_KEY]?: Map<string, RegisteredMessageEntry[]>;
  [REGISTERED_MESSAGE_LOADERS_KEY]?: Map<string, RegisteredMessageLoaderState>;
  [REGISTERED_MESSAGE_LOADER_GROUPS_KEY]?: Map<string, RegisteredMessageLoaderGroup>;
};

export function globalRuntimeState(): GlobalRuntimeState {
  return globalThis as GlobalRuntimeState;
}

type WindowlessClientRuntimeState = GlobalRuntimeState & {
  importScripts?: unknown;
  self?: unknown;
  WorkerGlobalScope?: unknown;
};

function isCloudflareWorkersEnvironment(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function isWindowlessClientEnvironment(): boolean {
  // Cloudflare documents this user agent as a reliable Workers marker. Check it
  // before browser-worker signals because workerd exposes their global classes,
  // and a future constructor-identity fix could make `instanceof` succeed.
  if (isCloudflareWorkersEnvironment()) {
    return false;
  }

  const state = globalRuntimeState() as WindowlessClientRuntimeState;
  if (typeof state.importScripts === "function") {
    return true;
  }

  const workerGlobalScope = state.WorkerGlobalScope;
  return typeof workerGlobalScope === "function" && state.self instanceof workerGlobalScope;
}

/**
 * Classify the current runtime consistently across Palamedes packages.
 * Browser workers are client environments even though they do not expose a
 * `window` global.
 */
export function isServerEnvironment(): boolean {
  return typeof window === "undefined" && !isWindowlessClientEnvironment();
}

export function getRegisteredMessages(
  state = globalRuntimeState(),
): Map<string, RegisteredMessageEntry[]> {
  const existing = state[REGISTERED_MESSAGES_KEY];
  if (existing) {
    return existing;
  }

  const registered = new Map<string, RegisteredMessageEntry[]>();
  state[REGISTERED_MESSAGES_KEY] = registered;
  return registered;
}

export function getRegisteredMessageLoaders(
  state = globalRuntimeState(),
): Map<string, RegisteredMessageLoaderState> {
  const existing = state[REGISTERED_MESSAGE_LOADERS_KEY];
  if (existing) {
    return existing;
  }

  const registered = new Map<string, RegisteredMessageLoaderState>();
  state[REGISTERED_MESSAGE_LOADERS_KEY] = registered;
  return registered;
}

export function getRegisteredMessageLoaderGroups(
  state = globalRuntimeState(),
): Map<string, RegisteredMessageLoaderGroup> {
  const existing = state[REGISTERED_MESSAGE_LOADER_GROUPS_KEY];
  if (existing) {
    return existing;
  }

  const registered = new Map<string, RegisteredMessageLoaderGroup>();
  state[REGISTERED_MESSAGE_LOADER_GROUPS_KEY] = registered;
  return registered;
}

export function createRegisteredMessageLoaderState(
  loaders: Record<string, RegisteredMessageLoader>,
): RegisteredMessageLoaderState {
  return { loaders, resources: new Map() };
}

/**
 * Plain JavaScript callers can still pass an instance without `load()`.
 * Generated catalog messages cannot reach such an instance, so fail before
 * a later render reports a confusing missing message.
 */
export function assertCanLoadMessages(i18n: I18nInstance, role: string): void {
  if (typeof i18n.load !== "function") {
    throw new TypeError(
      `The ${role} i18n instance cannot load generated catalog messages. Provide an instance with load(locale, messages).`,
    );
  }
}

// Registered maps are generated compiled catalogs. They are stored untyped
// because registration only buffers them; `load()` validates the brand.
export function loadMessages(
  i18n: I18nInstance,
  locale: string,
  messages: Record<string, unknown>,
): void {
  i18n.load(locale, messages as CompiledCatalogMessages);
}

/**
 * Install the active client instance after flushing buffered eager
 * registrations into it. Shared by `setClientI18n()` and the generated-code
 * bootstrap in `@palamedes/runtime/internal`.
 */
export function installClientI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState();
  const registered = state[REGISTERED_MESSAGES_KEY];
  if (registered && registered.size > 0) {
    assertCanLoadMessages(i18n, "client");
    for (const [locale, entries] of registered) {
      for (const entry of entries) {
        loadMessages(i18n, locale, entry.messages);
      }
    }
  }
  state[CLIENT_I18N_KEY] = i18n;
  return i18n;
}
