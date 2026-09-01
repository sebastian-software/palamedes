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
import { createElement, type Handle, type RemixElement, type RemixNode } from "remix/ui"

export type TransProps = {
  // `id` is optional in authored source: the compiler injects it after
  // resolving the source message and optional context.
  id?: string
  message?: string
  context?: string
  comment?: string
  values?: Record<string, unknown>
  components?: Record<string, RemixElement>
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
type ResettableRemixMessageRuntime = {
  reset: () => void
  runtime: CompiledMessageRuntime<RemixNode[]>
}
type CachedRemixMessageRuntime = ResettableRemixMessageRuntime & {
  locale: string
  timeZone: string | undefined
}

const EMPTY_COMPONENTS: Record<string, RemixElement> = Object.freeze({})
const EMPTY_VALUES: Record<string, unknown> = Object.freeze({})

/** Creates a Remix UI component factory for compatibility and compiled entries. */
export function createTrans(useI18n: () => RendererI18n, fallbackParser?: PatternParser) {
  const runtimeCache = createRemixMessageRuntimeCache(fallbackParser)

  return function Trans(handle: Handle<TransProps>) {
    return (): RemixNode => {
      const { id, message, values, components, context, comment } = handle.props
      const i18n = useI18n()
      const resolvedId = id ?? message ?? ""
      const metadata: MessageMetadata = {
        message,
        context,
        comment,
        renderUncompiledPattern: fallbackParser !== undefined,
      }
      const runtime = runtimeCache.get(i18n, components ?? EMPTY_COMPONENTS)
      return renderI18nMessage(i18n, resolvedId, values ?? EMPTY_VALUES, runtime, metadata)
    }
  }
}

export function createRemixMessageRuntimeCache(fallbackParser?: PatternParser) {
  const cache = new WeakMap<
    RendererI18n,
    WeakMap<Record<string, RemixElement>, CachedRemixMessageRuntime>
  >()

  return {
    get(
      i18n: RendererI18n,
      components: Record<string, RemixElement>
    ): CompiledMessageRuntime<RemixNode[]> {
      let byComponents = cache.get(i18n)
      if (byComponents === undefined) {
        byComponents = new WeakMap()
        cache.set(i18n, byComponents)
      }

      let cached = byComponents.get(components)
      if (
        cached === undefined ||
        cached.locale !== i18n.locale ||
        cached.timeZone !== i18n.timeZone
      ) {
        cached = {
          ...createResettableRemixMessageRuntime(i18n, components, fallbackParser),
          locale: i18n.locale,
          timeZone: i18n.timeZone,
        }
        byComponents.set(components, cached)
      }
      cached.reset()
      return cached.runtime
    },
  }
}

export function renderI18nMessage(
  i18n: RendererI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<RemixNode[]>,
  metadata: MessageMetadata
): RemixNode[] {
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

export function createRemixMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RemixElement>,
  fallbackParser?: PatternParser
): CompiledMessageRuntime<RemixNode[]> {
  return createResettableRemixMessageRuntime(i18n, components, fallbackParser).runtime
}

function createResettableRemixMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RemixElement>,
  fallbackParser?: PatternParser
): ResettableRemixMessageRuntime {
  const locale = i18n.locale
  const timeZone = i18n.timeZone
  let nextKey = 0
  const runtime: CompiledMessageRuntime<RemixNode[]> = createCompiledMessageRuntime<RemixNode[]>(
    locale,
    {
      pattern(pattern, values) {
        const nodes = parsePattern(i18n, pattern, fallbackParser)
        return renderNodes(nodes, values, runtime, locale)
      },
      join(...parts) {
        return parts.flatMap((part) => (typeof part === "string" ? [part] : part))
      },
      value(value) {
        return renderVariable(value)
      },
      number(value, style) {
        return [formatMessageArgument("number", value, style, locale)]
      },
      date(value, style) {
        return [formatMessageArgument("date", value, style, locale, timeZone)]
      },
      time(value, style) {
        return [formatMessageArgument("time", value, style, locale, timeZone)]
      },
      pound(value) {
        return [replacePoundPlaceholders("#", value, locale)]
      },
      literal(value) {
        return [value]
      },
      tag(name, children) {
        const component = components[name]
        if (isRemixElement(component)) {
          return [
            createElement(component.type, { ...component.props, key: nextKey++ }, ...children),
          ]
        }
        return children
      },
    }
  )

  return {
    reset() {
      nextKey = 0
    },
    runtime,
  }
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
  return i18n.getMessageNodes(pattern, { message: pattern, reportMissing: false })
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<RemixNode[]>,
  locale: string,
  pluralValue?: number
): RemixNode[] {
  return nodes.flatMap((node) => renderNode(node, values, runtime, locale, pluralValue))
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<RemixNode[]>,
  locale: string,
  pluralValue?: number
): RemixNode[] {
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

function renderVariable(value: unknown): RemixNode[] {
  if (Array.isArray(value)) {
    return value.flatMap(renderVariable)
  }
  if (isRemixElement(value)) {
    return [value]
  }
  return [stringifyValue(value)]
}

function isRemixElement(value: unknown): value is RemixElement {
  const element = value as Partial<RemixElement> | null
  return (
    typeof element === "object" &&
    element !== null &&
    element.$rmx === true &&
    (typeof element.type === "string" || typeof element.type === "function") &&
    typeof element.props === "object" &&
    element.props !== null
  )
}
