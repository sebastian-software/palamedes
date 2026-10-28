import {
  CLIENT_I18N_KEY,
  type GlobalRuntimeState,
  globalRuntimeState,
  type I18nInstance,
  installClientI18n,
  isServerEnvironment,
  SERVER_I18N_GETTER_KEY,
  SERVER_SCOPE_STATE_KEY,
} from "./state";

export { type I18nInstance, isServerEnvironment };

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined;

export type ServerI18nScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(i18n: T, callback: () => Result): Result;
  activate(i18n: T): T;
  get(): T | undefined;
};

export type CreateServerI18nScopeOptions = {
  /**
   * A framework adapter's stable request/render identity. The provider ID
   * replaces an earlier registration from the same adapter during dev HMR.
   */
  requestKeyProvider?: {
    get(): object | undefined;
    id: symbol;
  };
};

function getActiveServerI18n(state: GlobalRuntimeState): I18nInstance | undefined {
  return state[SERVER_I18N_GETTER_KEY]?.() ?? state[SERVER_SCOPE_STATE_KEY]?.active.getStore();
}

function hasRegisteredServerI18n(state: GlobalRuntimeState): boolean {
  return state[SERVER_I18N_GETTER_KEY] !== undefined || state[SERVER_SCOPE_STATE_KEY] !== undefined;
}

/**
 * Install the active client instance and flush buffered message
 * registrations into it. Throws, like `loadRegisteredMessages()`, when
 * registrations exist and the instance cannot load them.
 */
export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  return installClientI18n(i18n);
}

export function setServerI18nGetter<T extends I18nInstance>(getter: ServerI18nGetter<T>): void {
  globalRuntimeState()[SERVER_I18N_GETTER_KEY] = getter as ServerI18nGetter;
}

/**
 * Enter the request scope created by `@palamedes/runtime/server` from an
 * isomorphic SSR bundle that cannot import the Node-only server subpath.
 */
export function activateServerI18n<T extends I18nInstance>(i18n: T): T {
  const state = globalRuntimeState();
  const scopeState = state[SERVER_SCOPE_STATE_KEY];
  if (!scopeState) {
    throw new Error(
      "No server i18n scope is configured. Create one with createServerI18nScope() from @palamedes/runtime/server before activating SSR client components.",
    );
  }
  state[SERVER_I18N_GETTER_KEY] ??= () => scopeState.get();
  const activeI18n = scopeState.get();
  if (activeI18n === i18n) {
    return i18n;
  }
  scopeState.activate(i18n);
  return i18n;
}

export function getI18n<T extends I18nInstance = I18nInstance>(): T {
  const state = globalRuntimeState();
  if (typeof window === "undefined") {
    const serverI18n = getActiveServerI18n(state);
    if (serverI18n) {
      return serverI18n as T;
    }

    if (isServerEnvironment() || hasRegisteredServerI18n(state)) {
      throw new Error(
        "No active server i18n instance. Configure @palamedes/runtime with setServerI18nGetter() before translated code runs.",
      );
    }
  }

  const activeClientI18n = state[CLIENT_I18N_KEY];
  if (!activeClientI18n) {
    throw new Error(
      "No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs.",
    );
  }

  return activeClientI18n as T;
}

export function resetI18nRuntime(): void {
  const state = globalRuntimeState();
  delete state[CLIENT_I18N_KEY];
  delete state[SERVER_I18N_GETTER_KEY];
}
