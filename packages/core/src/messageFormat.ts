import { formatMessageArgument, replacePoundPlaceholders, stringifyValue } from "./runtimeFormat"
import { resolveChoice, type ResolvedChoice } from "./runtimeChoice"

export type MessageTextNode = {
  type: "text"
  value: string
}

export type MessageLiteralNode = {
  type: "literal"
  value: string
}

export type MessageVariableNode = {
  type: "variable"
  name: string
}

export type MessageFormattedArgumentNode = {
  type: "formatted"
  variable: string
  format: "number" | "date" | "time"
  style?: string
}

export type MessageChoiceNode = {
  type: "choice"
  variable: string
  kind: "plural" | "select" | "selectordinal"
  offset?: number
  options: Record<string, MessageNode[]>
}

export type MessageTagNode = {
  type: "tag"
  name: string
  children: MessageNode[]
}

export type MessageNode =
  | MessageTextNode
  | MessageLiteralNode
  | MessageVariableNode
  | MessageFormattedArgumentNode
  | MessageChoiceNode
  | MessageTagNode

const parseCache = new Map<string, MessageNode[]>()

// Keep this marker stable: the browser bundle check uses it to prove both that
// the compatibility entry still contains the parser and compiled apps do not.
const PARSER_BUNDLE_SENTINEL = "[palamedes:icu-parser]"

// Parsed patterns are keyed by the full message text, so the working set is the
// app's message count — sharing the formatter bound made any catalog with more
// than 64 messages evict continuously and re-parse everything on every render.
const PARSE_CACHE_LIMIT = 1024

type ParserState = {
  input: string
  index: number
}

export function parseMessagePattern(pattern: string): MessageNode[] {
  const cached = parseCache.get(pattern)
  if (cached) {
    // Refresh insert order on every hit so eviction is least-recently-used
    // instead of first-in: messages rendered on every frame then outlive the
    // one-off dynamic patterns that pass through the cache.
    parseCache.delete(pattern)
    parseCache.set(pattern, cached)
    return cached
  }

  const state: ParserState = {
    input: pattern,
    index: 0,
  }
  const nodes = parseNodes(state, undefined, false)
  // i18n._(rawPattern) accepts arbitrary strings, so this cache must stay
  // bounded or dynamic patterns grow it forever.
  rememberInCache(parseCache, pattern, nodes, PARSE_CACHE_LIMIT)
  return nodes
}

export function formatMessagePattern(
  pattern: string,
  values: Record<string, unknown> = {},
  locale?: string,
  timeZone?: string
): string {
  return renderNodesToString(parseMessagePattern(pattern), values, locale, timeZone)
}

function parseNodes(
  state: ParserState,
  closingTag: string | undefined,
  poundIsSyntax: boolean
): MessageNode[] {
  const nodes: MessageNode[] = []

  while (state.index < state.input.length) {
    if (closingTag && state.input.startsWith(`</${closingTag}>`, state.index)) {
      state.index += closingTag.length + 3
      break
    }

    const char = state.input[state.index]
    if (char === "{") {
      nodes.push(parseBraceExpression(state, poundIsSyntax))
      continue
    }

    if (char === "<" && isTagStart(state)) {
      nodes.push(parseTag(state, poundIsSyntax))
      continue
    }

    if (char === "'" && startsQuotedLiteral(state, poundIsSyntax)) {
      nodes.push(parseQuotedLiteral(state))
      continue
    }

    nodes.push(parseText(state, closingTag, poundIsSyntax))
  }

  return mergeTextNodes(nodes)
}

function parseText(
  state: ParserState,
  closingTag: string | undefined,
  poundIsSyntax: boolean
): MessageTextNode {
  const start = state.index

  while (state.index < state.input.length) {
    if (closingTag && state.input.startsWith(`</${closingTag}>`, state.index)) {
      break
    }

    const char = state.input[state.index]
    if (char === "{") {
      break
    }

    if (char === "<" && isTagStart(state)) {
      break
    }

    if (char === "'" && startsQuotedLiteral(state, poundIsSyntax)) {
      break
    }

    state.index += 1
  }

  return {
    type: "text",
    value: state.input.slice(start, state.index),
  }
}

function parseBraceExpression(state: ParserState, poundIsSyntax: boolean): MessageNode {
  state.index += 1
  skipWhitespace(state)
  const name = readUntil(state, [",", "}"]).trim()
  const next = state.input[state.index]

  if (next === "}") {
    state.index += 1
    return {
      type: "variable",
      name,
    }
  }

  expectChar(state, ",")
  skipWhitespace(state)
  const kind = readUntil(state, [",", "}"]).trim()

  if (isFormattedArgumentKind(kind)) {
    const style = readOptionalStyle(state)
    expectChar(state, "}")

    return {
      type: "formatted",
      variable: name,
      format: kind,
      style,
    }
  }

  expectChar(state, ",")
  const offset = kind === "plural" || kind === "selectordinal" ? readPluralOffset(state) : undefined

  // A null prototype keeps message-supplied option keys off Object.prototype:
  // `{n, select, other {…}}` looked up with the value "toString" must not
  // resolve to a function, and an option literally named "__proto__" must be a
  // plain entry rather than a prototype assignment.
  const options = Object.create(null) as Record<string, MessageNode[]>
  while (state.index < state.input.length) {
    skipWhitespace(state)
    if (state.input[state.index] === "}") {
      state.index += 1
      break
    }

    const key = readUntil(state, ["{"]).trim()
    expectChar(state, "{")
    options[key] = parseNodesUntilBrace(
      state,
      kind === "plural" || kind === "selectordinal" || poundIsSyntax
    )
  }

  return {
    type: "choice",
    variable: name,
    kind: kind as MessageChoiceNode["kind"],
    ...(offset === undefined ? {} : { offset }),
    options,
  }
}

function readPluralOffset(state: ParserState): number | undefined {
  skipWhitespace(state)
  if (!state.input.startsWith("offset:", state.index)) {
    return undefined
  }

  state.index += "offset:".length
  skipWhitespace(state)
  const start = state.index
  while (/\d/.test(state.input[state.index] ?? "")) {
    state.index += 1
  }

  const offset = Number(state.input.slice(start, state.index))
  if (
    state.index === start ||
    !Number.isSafeInteger(offset) ||
    !/\s/.test(state.input[state.index] ?? "")
  ) {
    throw parserError(
      `Expected a non-negative integer plural offset at index ${state.index} while parsing message pattern: ${patternExcerpt(state)}`
    )
  }

  return offset
}

function isFormattedArgumentKind(kind: string): kind is MessageFormattedArgumentNode["format"] {
  return kind === "number" || kind === "date" || kind === "time"
}

function readOptionalStyle(state: ParserState): string | undefined {
  if (state.input[state.index] !== ",") {
    return undefined
  }

  state.index += 1
  const style = readUntil(state, ["}"]).trim()
  return style.length > 0 ? style : undefined
}

function parseNodesUntilBrace(state: ParserState, poundIsSyntax: boolean): MessageNode[] {
  const nodes: MessageNode[] = []

  while (state.index < state.input.length) {
    const char = state.input[state.index]
    if (char === "}") {
      state.index += 1
      break
    }

    if (char === "{") {
      nodes.push(parseBraceExpression(state, poundIsSyntax))
      continue
    }

    if (char === "<" && isTagStart(state)) {
      nodes.push(parseTag(state, poundIsSyntax))
      continue
    }

    if (char === "'" && startsQuotedLiteral(state, poundIsSyntax)) {
      nodes.push(parseQuotedLiteral(state))
      continue
    }

    nodes.push(parseTextUntilBrace(state, poundIsSyntax))
  }

  return mergeTextNodes(nodes)
}

function parseTextUntilBrace(state: ParserState, poundIsSyntax: boolean): MessageTextNode {
  const start = state.index

  while (state.index < state.input.length) {
    const char = state.input[state.index]
    if (char === "}" || char === "{") {
      break
    }

    if (char === "<" && isTagStart(state)) {
      break
    }

    if (char === "'" && startsQuotedLiteral(state, poundIsSyntax)) {
      break
    }

    state.index += 1
  }

  return {
    type: "text",
    value: state.input.slice(start, state.index),
  }
}

function parseTag(state: ParserState, poundIsSyntax: boolean): MessageTagNode {
  expectChar(state, "<")
  const name = readUntil(state, ["/", ">"]).trim()

  // Self-closing placeholder `<name/>` (e.g. `<br/>`): the emitter produces this
  // compact form for component placeholders with no children. Consume `/>` and
  // yield a tag node with an empty child list.
  if (state.input[state.index] === "/") {
    state.index += 1
    expectChar(state, ">")

    return {
      type: "tag",
      name,
      children: [],
    }
  }

  expectChar(state, ">")
  const children = parseNodes(state, name, poundIsSyntax)

  return {
    type: "tag",
    name,
    children,
  }
}

function startsQuotedLiteral(state: ParserState, poundIsSyntax: boolean): boolean {
  const next = state.input[state.index + 1]
  return next === "'" || next === "{" || next === "}" || (poundIsSyntax && next === "#")
}

function parseQuotedLiteral(state: ParserState): MessageLiteralNode {
  state.index += 1

  if (state.input[state.index] === "'") {
    state.index += 1
    return {
      type: "literal",
      value: "'",
    }
  }

  let value = ""
  while (state.index < state.input.length) {
    const char = state.input[state.index]
    if (char !== "'") {
      value += char
      state.index += 1
      continue
    }

    if (state.input[state.index + 1] === "'") {
      value += "'"
      state.index += 2
      continue
    }

    state.index += 1
    break
  }

  return {
    type: "literal",
    value,
  }
}

function isTagStart(state: ParserState): boolean {
  const slice = state.input.slice(state.index)
  return /^<([A-Za-z0-9_]+)\/?>/.test(slice)
}

function readUntil(state: ParserState, delimiters: string[]): string {
  const start = state.index
  while (
    state.index < state.input.length &&
    !delimiters.includes(state.input[state.index] as string)
  ) {
    state.index += 1
  }
  return state.input.slice(start, state.index)
}

function skipWhitespace(state: ParserState): void {
  while (/\s/.test(state.input[state.index] ?? "")) {
    state.index += 1
  }
}

function expectChar(state: ParserState, expected: string): void {
  if (state.input[state.index] !== expected) {
    const found = state.input[state.index]
    throw parserError(
      `Expected "${expected}" but found ${
        found === undefined ? "end of pattern" : `"${found}"`
      } at index ${state.index} while parsing message pattern: ${patternExcerpt(state)}`
    )
  }
  state.index += 1
}

function parserError(message: string): Error {
  return new Error(`${PARSER_BUNDLE_SENTINEL} ${message}`)
}

/* A short window around the failure point so telemetry can locate it. */
function patternExcerpt(state: ParserState): string {
  const start = Math.max(0, state.index - 20)
  const end = Math.min(state.input.length, state.index + 20)
  const prefix = start > 0 ? "…" : ""
  const suffix = end < state.input.length ? "…" : ""
  return `${prefix}${state.input.slice(start, end)}${suffix}`
}

function mergeTextNodes(nodes: MessageNode[]): MessageNode[] {
  const merged: MessageNode[] = []

  for (const node of nodes) {
    const last = merged.at(-1)
    if (last?.type === "text" && node.type === "text") {
      last.value += node.value
      continue
    }
    if (node.type === "text" && node.value.length === 0) {
      continue
    }
    merged.push(node)
  }

  return merged
}

function renderNodesToString(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  locale?: string,
  timeZone?: string,
  pluralValue?: number
): string {
  return nodes
    .map((node) => renderNodeToString(node, values, locale, timeZone, pluralValue))
    .join("")
}

function renderNodeToString(
  node: MessageNode,
  values: Record<string, unknown>,
  locale?: string,
  timeZone?: string,
  pluralValue?: number
): string {
  switch (node.type) {
    case "text": {
      return pluralValue === undefined
        ? node.value
        : replacePoundPlaceholders(node.value, pluralValue, locale)
    }
    case "literal": {
      return node.value
    }
    case "variable": {
      return stringifyValue(values[node.name])
    }
    case "formatted": {
      return formatMessageArgument(node.format, values[node.variable], node.style, locale, timeZone)
    }
    case "tag": {
      return renderNodesToString(node.children, values, locale, timeZone, pluralValue)
    }
    case "choice": {
      const resolved = resolveChoice(node, values[node.variable], locale)
      const nextPluralValue = node.kind === "select" ? pluralValue : resolved.pluralValue
      return renderNodesToString(resolved.nodes, values, locale, timeZone, nextPluralValue)
    }
  }
}

function rememberInCache<TValue>(
  cache: Map<string, TValue>,
  key: string,
  value: TValue,
  limit: number
): TValue {
  if (!cache.has(key) && cache.size >= limit) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }

  cache.set(key, value)
  return value
}

export {
  formatMessageArgument,
  replacePoundPlaceholders,
  resolveChoice,
  stringifyValue,
  type ResolvedChoice,
}
