"use client"

import { useSyncExternalStore } from "react"

import { getI18n as getRuntimeI18n, type I18nInstance } from "@palamedes/runtime"

import {
  getReactiveI18nSnapshot,
  getServerI18nSnapshot,
  subscribeReactiveI18n,
} from "./clientStore"

/**
 * React-aware replacement for `@palamedes/runtime`'s `getI18n`.
 *
 * Configure the Palamedes transform to import this function for translated
 * client components that must re-render after `setClientI18n()` activates a
 * locale. The `react-server` export condition resolves to the hook-free server
 * implementation instead.
 */
function useReactiveI18n<T extends I18nInstance = I18nInstance>(): T {
  useSyncExternalStore(subscribeReactiveI18n, getReactiveI18nSnapshot, getServerI18nSnapshot)
  return getRuntimeI18n<T>()
}

/*
 * The hook exists only to subscribe: its return value is unused and the
 * instance always comes from the runtime getter. On the server there is
 * nothing to subscribe to, but translated code does run outside component
 * rendering — route actions and loaders — where calling a hook crashes on a
 * null dispatcher. Server environments therefore resolve the runtime getter
 * directly; only browsers take the reactive hook path. The `react-server`
 * export condition already maps RSC bundles to ./runtime-server; this branch
 * covers non-RSC SSR bundles, which resolve this default entry.
 */
const getI18n = typeof window === "undefined" ? getRuntimeI18n : useReactiveI18n

export { getI18n }
