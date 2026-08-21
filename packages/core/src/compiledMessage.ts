import {
  formatMessageArgument,
  replacePoundPlaceholders,
  requireChoiceNumericValue,
  selectPluralCategory,
  stringifyValue,
} from "./runtimeFormat"

export type MessageValues = Record<string, unknown>

export type CompiledMessage = <TResult>(
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>
) => TResult

export type CompiledMessageBranch = <TResult>(
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>,
  pluralValue?: number
) => TResult

export type CompiledMessageBranches = Record<string, CompiledMessageBranch>

export type CompiledMessageRuntime<TResult> = {
  pattern: (pattern: string, values: MessageValues) => TResult
  join: (...parts: Array<string | TResult>) => TResult
  value: (values: MessageValues, name: string) => TResult
  number: (values: MessageValues, name: string, style?: string) => TResult
  date: (values: MessageValues, name: string, style?: string) => TResult
  time: (values: MessageValues, name: string, style?: string) => TResult
  select: (
    values: MessageValues,
    name: string,
    branches: CompiledMessageBranches,
    pluralValue?: number
  ) => TResult
  plural: (
    values: MessageValues,
    name: string,
    offset: number,
    kind: "plural" | "selectordinal",
    branches: CompiledMessageBranches
  ) => TResult
  pound: (pluralValue: number) => TResult
  literal: (value: string) => TResult
  tag: (name: string, children: TResult) => TResult
}

export type CatalogMessage = string | CompiledMessage
export type CatalogMessages = Record<string, string>

declare const COMPILED_CATALOG_TYPE: unique symbol

type CompiledCatalogBrand = {
  readonly [COMPILED_CATALOG_TYPE]: true
}

export type CompiledCatalogMessages = Record<string, CatalogMessage> & CompiledCatalogBrand
export type LoadableCatalogMessages = CatalogMessages | CompiledCatalogMessages

const COMPILED_CATALOG_SYMBOL = Symbol.for("@palamedes/core/compiled-catalog")

/** Marks generated strings as constants; function entries are executable messages. */
export function defineCompiledCatalog<TMessages extends Record<string, CatalogMessage>>(
  messages: TMessages
): TMessages & CompiledCatalogBrand {
  Object.defineProperty(messages, COMPILED_CATALOG_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return messages as TMessages & CompiledCatalogBrand
}

export function isCompiledCatalog(
  messages: LoadableCatalogMessages
): messages is CompiledCatalogMessages {
  return (
    (messages as LoadableCatalogMessages & Record<symbol, boolean | undefined>)[
      COMPILED_CATALOG_SYMBOL
    ] === true
  )
}

export type ExecutableMessageRenderer<TResult> = {
  pattern: (pattern: string, values: MessageValues) => TResult
  join: (...parts: Array<string | TResult>) => TResult
  value: (value: unknown) => TResult
  number: (value: unknown, style?: string) => TResult
  date: (value: unknown, style?: string) => TResult
  time: (value: unknown, style?: string) => TResult
  pound: (pluralValue: number) => TResult
  literal: (value: string) => TResult
  tag: (name: string, children: TResult) => TResult
}

/** Adds shared select/plural execution to a host-specific result renderer. */
export function createCompiledMessageRuntime<TResult>(
  locale: string,
  renderer: ExecutableMessageRenderer<TResult>
): CompiledMessageRuntime<TResult> {
  const runtime: CompiledMessageRuntime<TResult> = {
    ...renderer,
    value(values, name) {
      return renderer.value(values[name])
    },
    number(values, name, style) {
      return renderer.number(values[name], style)
    },
    date(values, name, style) {
      return renderer.date(values[name], style)
    },
    time(values, name, style) {
      return renderer.time(values[name], style)
    },
    select(values, name, branches, pluralValue) {
      const value = values[name]
      const exact = value == null ? undefined : getBranch(branches, String(value))
      return runBranch(exact ?? getBranch(branches, "other"), values, runtime, pluralValue)
    },
    plural(values, name, offset, kind, branches) {
      const numericValue = requireChoiceNumericValue(name, kind, values[name])
      const operand = numericValue - offset
      const exact = getBranch(branches, `=${numericValue}`)
      if (exact !== undefined) {
        return runBranch(exact, values, runtime, operand)
      }
      const category = selectPluralCategory(operand, locale, kind)
      return runBranch(
        getBranch(branches, category) ?? getBranch(branches, "other"),
        values,
        runtime,
        operand
      )
    },
  }
  return runtime
}

export type PatternFormatter = (
  pattern: string,
  values: MessageValues,
  locale: string,
  timeZone?: string
) => string

export function createStringMessageRuntime(
  locale: string,
  formatPattern: PatternFormatter,
  timeZone?: string
): CompiledMessageRuntime<string> {
  return createCompiledMessageRuntime(locale, {
    pattern(pattern, values) {
      return formatPattern(pattern, values, locale, timeZone)
    },
    join(...parts) {
      return parts.join("")
    },
    value: stringifyValue,
    number(value, style) {
      return formatMessageArgument("number", value, style, locale)
    },
    date(value, style) {
      return formatMessageArgument("date", value, style, locale, timeZone)
    },
    time(value, style) {
      return formatMessageArgument("time", value, style, locale, timeZone)
    },
    pound(value) {
      return replacePoundPlaceholders("#", value, locale)
    },
    literal(value) {
      return value
    },
    tag(_name, children) {
      return children
    },
  })
}

export function compiledMessageSource(message: CompiledMessage): string {
  return message<SourceFragment>({}, SOURCE_RUNTIME).source
}

function getBranch(
  branches: CompiledMessageBranches,
  key: string
): CompiledMessageBranch | undefined {
  return Object.hasOwn(branches, key) ? branches[key] : undefined
}

function runBranch<TResult>(
  branch: CompiledMessageBranch | undefined,
  values: MessageValues,
  runtime: CompiledMessageRuntime<TResult>,
  pluralValue?: number
): TResult {
  return branch === undefined ? runtime.join() : branch<TResult>(values, runtime, pluralValue)
}

type SourceFragment = { source: string }

function source(fragment: string): SourceFragment {
  return { source: fragment }
}

const SOURCE_RUNTIME: CompiledMessageRuntime<SourceFragment> = {
  pattern(pattern) {
    return source(pattern)
  },
  join(...parts) {
    return source(
      parts
        .map((part) => (typeof part === "string" ? escapeMessageText(part) : part.source))
        .join("")
    )
  },
  value(_values, name) {
    return source(`{${name}}`)
  },
  number(_values, name, style) {
    return source(renderFormattedSource(name, "number", style))
  },
  date(_values, name, style) {
    return source(renderFormattedSource(name, "date", style))
  },
  time(_values, name, style) {
    return source(renderFormattedSource(name, "time", style))
  },
  select(values, name, branches, pluralValue) {
    return renderChoiceSource(values, name, "select", 0, branches, pluralValue)
  },
  plural(values, name, offset, kind, branches) {
    return renderChoiceSource(values, name, kind, offset, branches, 0)
  },
  pound() {
    return source("#")
  },
  literal(value) {
    return source(`'${value.replaceAll("'", "''")}'`)
  },
  tag(name, children) {
    return source(
      children.source.length === 0 ? `<${name}/>` : `<${name}>${children.source}</${name}>`
    )
  },
}

function renderFormattedSource(name: string, format: string, style: string | undefined): string {
  return `{${name}, ${format}${style === undefined ? "" : `, ${style}`}}`
}

function renderChoiceSource(
  values: MessageValues,
  name: string,
  kind: "plural" | "select" | "selectordinal",
  offset: number,
  branches: CompiledMessageBranches,
  pluralValue?: number
): SourceFragment {
  const options = Object.entries(branches)
    .map(
      ([selector, branch]) =>
        `${selector} {${branch<SourceFragment>(values, SOURCE_RUNTIME, pluralValue).source}}`
    )
    .join(" ")
  const offsetSource = offset === 0 ? "" : ` offset:${offset}`
  return source(`{${name}, ${kind},${offsetSource} ${options}}`)
}

function escapeMessageText(value: string): string {
  let escaped = ""
  for (const character of value) {
    if (character === "'") {
      escaped += "''"
    } else if (character === "{" || character === "}") {
      escaped += `'${character}'`
    } else {
      escaped += character
    }
  }
  return escaped
}
