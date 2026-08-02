import * as React from "react"
import { cloneElement, Fragment, isValidElement } from "react"
import type { ReactElement, ReactNode } from "react"

import {
  createCompiledMessageRuntime,
  formatMessageArgument,
  replacePoundPlaceholders,
  resolveChoice,
  stringifyValue,
} from "@palamedes/core/compiled"
import type {
  CompiledMessageRuntime,
  MessageMetadata,
  MessageNode,
  PalamedesI18n,
} from "@palamedes/core/compiled"

export type CompiledTransProps = {
  id?: string
  message?: string
  context?: string
  comment?: string
  values?: Record<string, unknown>
  components?: Record<string, ReactElement>
}

/** Creates the parser-free Trans component used by transformed production code. */
export function createCompiledTrans(useI18n: () => PalamedesI18n) {
  return function Trans({
    id,
    message,
    values,
    components,
    context,
    comment,
  }: CompiledTransProps): ReactNode {
    const i18n = useI18n()
    const resolvedId = id ?? message ?? ""
    const metadata: MessageMetadata = { message, context, comment }
    const runtime = createReactMessageRuntime(i18n, components ?? {})
    return <>{renderI18nMessage(i18n, resolvedId, values ?? {}, runtime, metadata)}</>
  }
}

function renderI18nMessage(
  i18n: PalamedesI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<ReactNode[]>,
  metadata: MessageMetadata
): ReactNode[] {
  if (typeof i18n.renderMessage === "function") {
    return i18n.renderMessage(id, values, runtime, metadata)
  }

  const nodes = i18n.getMessageNodes(id, metadata)
  try {
    return renderNodes(nodes, values, runtime, i18n.locale)
  } catch (error) {
    const fallback = metadata.message ?? id
    const pattern = i18n.getMessage(id, { ...metadata, reportMissing: false })
    i18n.reportError?.({ id, error, pattern, fallback, metadata })

    if (pattern !== fallback) {
      try {
        return runtime.pattern(fallback, values)
      } catch {
        // Fall through to plain source text when the fallback is malformed.
      }
    }

    return runtime.join(fallback)
  }
}

function createReactMessageRuntime(
  i18n: PalamedesI18n,
  components: Record<string, ReactElement>
): CompiledMessageRuntime<ReactNode[]> {
  const locale = i18n.locale
  let nextKey = 0
  const runtime: CompiledMessageRuntime<ReactNode[]> = createCompiledMessageRuntime<ReactNode[]>(
    locale,
    {
      pattern(pattern, values) {
        const nodes = i18n.getMessageNodes(pattern, { message: pattern, reportMissing: false })
        return renderNodes(nodes, values, runtime, locale)
      },
      join(...parts) {
        return parts.flatMap((part) => (typeof part === "string" ? [part] : part))
      },
      value(value) {
        return [renderVariable(value, nextKey++)]
      },
      number(value, style) {
        return [formatMessageArgument("number", value, style, locale)]
      },
      date(value, style) {
        return [formatMessageArgument("date", value, style, locale)]
      },
      time(value, style) {
        return [formatMessageArgument("time", value, style, locale)]
      },
      pound(value) {
        return [replacePoundPlaceholders("#", value, locale)]
      },
      literal(value) {
        return [value]
      },
      tag(name, children) {
        const component = components[name]
        if (component && isValidElement(component)) {
          return [cloneElement(component, { key: nextKey++ }, ...children)]
        }
        return children
      },
    }
  )
  return runtime
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<ReactNode[]>,
  locale: string,
  pluralValue?: number
): ReactNode[] {
  return nodes.flatMap((node) => renderNode(node, values, runtime, locale, pluralValue))
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<ReactNode[]>,
  locale: string,
  pluralValue?: number
): ReactNode[] {
  switch (node.type) {
    case "text":
      return [
        pluralValue === undefined
          ? node.value
          : replacePoundPlaceholders(node.value, pluralValue, locale),
      ]
    case "literal":
      return runtime.literal(node.value)
    case "variable":
      return runtime.value(values, node.name)
    case "formatted":
      return runtime[node.format](values, node.variable, node.style)
    case "tag":
      return runtime.tag(
        node.name,
        renderNodes(node.children, values, runtime, locale, pluralValue)
      )
    case "choice": {
      const resolved = resolveChoice(node, values[node.variable], locale)
      const nextPluralValue = node.kind === "select" ? pluralValue : resolved.pluralValue
      return renderNodes(resolved.nodes, values, runtime, locale, nextPluralValue)
    }
  }
}

function renderVariable(value: unknown, key: number): ReactNode {
  if (isValidElement(value)) {
    return cloneElement(value, { key })
  }
  return stringifyValue(value)
}

export { Fragment }
