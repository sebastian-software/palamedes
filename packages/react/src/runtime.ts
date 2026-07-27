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

export { useReactiveI18n as getI18n }
