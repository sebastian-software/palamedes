import { createComponent, createMemo, type Element, type FlowComponent } from "solid-js"

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

type RichTextComponent = FlowComponent<{}, Element>

export type TransProps = {
  // `id` is optional in authored source: components are written with `message`
  // and the Palamedes compiler transform injects the resolved id at build time.
  id?: string
  message?: string
  context?: string
  comment?: string
  values?: Record<string, unknown>
  components?: Record<string, RichTextComponent>
}

type PatternParser = (pattern: string) => MessageNode[]
type RendererI18n = Pick<
  PalamedesI18n,
  | "locale"
  | "timeZone"
  | "getMessage"
  | "getMessageNodes"
  | "parsePattern"
  | "renderMessage"
  | "reportError"
>

/** Creates the shared Trans component for compatibility and compiled entries. */
export function createTrans(getI18n: () => RendererI18n, fallbackParser?: PatternParser) {
  return function Trans(props: TransProps): Element {
    const content = createMemo(() => {
      const i18n = getI18n()
      const resolvedId = props.id ?? props.message ?? ""
      const metadata: MessageMetadata = {
        message: props.message,
        context: props.context,
        comment: props.comment,
        renderUncompiledPattern: fallbackParser !== undefined,
      }
      const runtime = createSolidMessageRuntime(i18n, props.components ?? {}, fallbackParser)
      return renderI18nMessage(i18n, resolvedId, props.values ?? {}, runtime, metadata)
    })

    return <>{content()}</>
  }
}

export function renderI18nMessage(
  i18n: RendererI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<Element[]>,
  metadata: MessageMetadata
): Element[] {
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

export function createSolidMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RichTextComponent>,
  fallbackParser?: PatternParser
): CompiledMessageRuntime<Element[]> {
  const locale = i18n.locale
  const timeZone = i18n.timeZone
  const runtime: CompiledMessageRuntime<Element[]> = createCompiledMessageRuntime<Element[]>(
    locale,
    {
      pattern(pattern: string, values: Record<string, unknown>) {
        const nodes = parsePattern(i18n, pattern, fallbackParser)
        return renderNodes(nodes, values, runtime, locale)
      },
      join(...parts: Array<string | Element[]>) {
        return parts.flatMap((part) => (typeof part === "string" ? [part] : part))
      },
      value(value: unknown) {
        return [renderVariable(value)]
      },
      number(value: unknown, style?: string) {
        return [formatMessageArgument("number", value, style, locale)]
      },
      date(value: unknown, style?: string) {
        return [formatMessageArgument("date", value, style, locale, timeZone)]
      },
      time(value: unknown, style?: string) {
        return [formatMessageArgument("time", value, style, locale, timeZone)]
      },
      pound(value: number) {
        return [replacePoundPlaceholders("#", value, locale)]
      },
      literal(value: string) {
        return [value]
      },
      tag(name: string, children: Element[]) {
        const component = components[name]
        if (component !== undefined) {
          return [
            createComponent(component, {
              get children() {
                return children
              },
            }),
          ]
        }
        return children
      },
    }
  )
  return runtime
}

function parsePattern(
  i18n: RendererI18n,
  pattern: string,
  fallbackParser?: PatternParser
): MessageNode[] {
  if (i18n.parsePattern !== undefined) {
    return i18n.parsePattern(pattern)
  }
  if (fallbackParser !== undefined) {
    return fallbackParser(pattern)
  }
  // Older custom instances predate the parse-only capability. Preserve their
  // compatibility behavior while current full runtimes avoid catalog lookup.
  return i18n.getMessageNodes(pattern, { message: pattern, reportMissing: false })
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<Element[]>,
  locale: string,
  pluralValue?: number
): Element[] {
  return nodes.flatMap((node) => renderNode(node, values, runtime, locale, pluralValue))
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<Element[]>,
  locale: string,
  pluralValue?: number
): Element[] {
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

  return []
}

function renderVariable(value: unknown): Element {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (value instanceof Date) {
    return stringifyValue(value)
  }
  return value as Element
}
