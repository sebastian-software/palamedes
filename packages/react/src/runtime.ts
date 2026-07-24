"use client"

import { useSyncExternalStore } from "react"

import {
  getClientI18nSnapshot,
  getI18n as getRuntimeI18n,
  subscribeClientI18n,
  type ClientI18nSnapshot,
  type I18nInstance,
} from "@palamedes/runtime"

const SERVER_CLIENT_I18N_SNAPSHOT: ClientI18nSnapshot = {
  i18n: undefined,
  revision: 0,
}

/**
 * React-aware replacement for `@palamedes/runtime`'s `getI18n`.
 *
 * Configure the Palamedes transform to import this function for translated
 * client components that must re-render after `setClientI18n()` activates a
 * locale. The `react-server` export condition resolves to the hook-free server
 * implementation instead.
 */
function useReactiveI18n<T extends I18nInstance = I18nInstance>(): T {
  useSyncExternalStore(
    subscribeClientI18n,
    getClientI18nSnapshot,
    () => SERVER_CLIENT_I18N_SNAPSHOT
  )
  return getRuntimeI18n<T>()
}

export { useReactiveI18n as getI18n }
