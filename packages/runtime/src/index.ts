export interface I18nInstance {
  _: (...args: any[]) => unknown
  locale?: string
}

type ServerI18nGetter<T extends I18nInstance = I18nInstance> = () => T | undefined

let clientI18n: I18nInstance | undefined
let serverI18nGetter: ServerI18nGetter | undefined

function isServerEnvironment(): boolean {
  return typeof window === "undefined"
}

export function setClientI18n<T extends I18nInstance>(i18n: T): T {
  clientI18n = i18n
  return i18n
}

export function setServerI18nGetter<T extends I18nInstance>(
  getter: ServerI18nGetter<T>
): void {
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

  if (!clientI18n) {
    throw new Error(
      "No active client i18n instance. Initialize @palamedes/runtime with setClientI18n() before translated code runs."
    )
  }

  return clientI18n as T
}

export function resetI18nRuntime(): void {
  clientI18n = undefined
  serverI18nGetter = undefined
}
