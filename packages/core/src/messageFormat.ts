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
const numberFormatCache = new Map<string, Intl.NumberFormat>()
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()
const FORMATTER_CACHE_LIMIT = 64

type ParserState = {
  input: string
  index: number
}

export function parseMessagePattern(pattern: string): MessageNode[] {
  const cached = parseCache.get(pattern)
  if (cached) {
    return cached
  }

  const state: ParserState = {
    input: pattern,
    index: 0,
  }
  const nodes = parseNodes(state, undefined, false)
  parseCache.set(pattern, nodes)
  return nodes
}

export function formatMessagePattern(
  pattern: string,
  values: Record<string, unknown> = {},
  locale?: string
): string {
  return renderNodesToString(parseMessagePattern(pattern), values, locale)
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

  const options: Record<string, MessageNode[]> = {}
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
    throw new Error("Expected a non-negative integer plural offset while parsing message pattern.")
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
    throw new Error(`Expected "${expected}" while parsing message pattern.`)
  }
  state.index += 1
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
  pluralValue?: number
): string {
  return nodes.map((node) => renderNodeToString(node, values, locale, pluralValue)).join("")
}

function renderNodeToString(
  node: MessageNode,
  values: Record<string, unknown>,
  locale?: string,
  pluralValue?: number
): string {
  switch (node.type) {
    case "text": {
      return pluralValue === undefined ? node.value : replacePound(node.value, pluralValue, locale)
    }
    case "literal": {
      return node.value
    }
    case "variable": {
      return stringifyValue(values[node.name])
    }
    case "formatted": {
      return formatArgument(node, values[node.variable], locale)
    }
    case "tag": {
      return renderNodesToString(node.children, values, locale, pluralValue)
    }
    case "choice": {
      const value = values[node.variable]
      const nextPluralValue =
        node.kind === "select" ? pluralValue : pluralOperand(node, normalizeNumericValue(value))
      return renderNodesToString(selectChoice(node, value, locale), values, locale, nextPluralValue)
    }
  }
}

function formatArgument(
  node: MessageFormattedArgumentNode,
  value: unknown,
  locale?: string
): string {
  if (node.format === "number") {
    const numericValue = normalizeFormattedNumberValue(value)
    if (numericValue === undefined) {
      return stringifyValue(value)
    }

    return getNumberFormatter(locale, node.style).format(numericValue)
  }

  const dateValue = normalizeDateValue(value)
  if (!dateValue) {
    return stringifyValue(value)
  }

  return getDateTimeFormatter(locale, node.format, node.style).format(dateValue)
}

function getNumberFormatter(
  locale: string | undefined,
  style: string | undefined
): Intl.NumberFormat {
  const cacheKey = `${locale ?? ""}\0${style ?? ""}`
  const cached = numberFormatCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const formatter = new Intl.NumberFormat(locale, parseNumberFormatOptions(style))
  return rememberFormatter(numberFormatCache, cacheKey, formatter)
}

function parseNumberFormatOptions(style: string | undefined): Intl.NumberFormatOptions {
  const normalized = style?.trim()
  if (!normalized) {
    return {}
  }

  const skeleton = normalized.startsWith("::") ? normalized.slice(2) : normalized

  if (skeleton === "percent") {
    return { style: "percent" }
  }

  if (skeleton === "integer") {
    return { maximumFractionDigits: 0 }
  }

  if (!normalized.startsWith("::")) {
    return {}
  }

  if (!skeleton.startsWith("currency/")) {
    return {}
  }

  const currency = skeleton.slice("currency/".length).trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(currency)) {
    return {
      style: "currency",
      currency,
    }
  }

  return {}
}

function normalizeDateValue(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  return undefined
}

function getDateTimeFormatter(
  locale: string | undefined,
  format: "date" | "time",
  style: string | undefined
): Intl.DateTimeFormat {
  const normalizedStyle = normalizeDateTimeStyle(style, format)
  const cacheKey = `${locale ?? ""}\0${format}\0${normalizedStyle ?? ""}`
  const cached = dateTimeFormatCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const options: Intl.DateTimeFormatOptions =
    format === "date" ? { dateStyle: normalizedStyle } : { timeStyle: normalizedStyle }
  const formatter = new Intl.DateTimeFormat(locale, options)
  return rememberFormatter(dateTimeFormatCache, cacheKey, formatter)
}

function normalizeDateTimeStyle(
  style: string | undefined,
  format: "date" | "time"
): "full" | "long" | "medium" | "short" | undefined {
  if (style === "full" || style === "long" || style === "medium" || style === "short") {
    return style
  }

  return format === "time" ? "short" : undefined
}

function selectChoice(node: MessageChoiceNode, value: unknown, locale?: string): MessageNode[] {
  if (node.kind === "select") {
    const exact = value == null ? undefined : node.options[String(value)]
    return exact ?? node.options.other ?? []
  }

  const numericValue = normalizeNumericValue(value)
  const exactKey = `=${numericValue}`
  if (node.options[exactKey]) {
    return node.options[exactKey]
  }

  const operand = pluralOperand(node, numericValue)
  const pluralRules = new Intl.PluralRules(undefined, {
    localeMatcher: "best fit",
    type: node.kind === "selectordinal" ? "ordinal" : "cardinal",
  })
  const resolvedRules = locale
    ? new Intl.PluralRules(locale, { type: node.kind === "selectordinal" ? "ordinal" : "cardinal" })
    : pluralRules
  const category = resolvedRules.select(operand)
  return node.options[category] ?? node.options.other ?? []
}

function pluralOperand(node: MessageChoiceNode, numericValue: number): number {
  return numericValue - (node.offset ?? 0)
}

function normalizeNumericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeFormattedNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function rememberFormatter<TFormatter>(
  cache: Map<string, TFormatter>,
  key: string,
  formatter: TFormatter
): TFormatter {
  if (!cache.has(key) && cache.size >= FORMATTER_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }

  cache.set(key, formatter)
  return formatter
}

function replacePound(value: string, numericValue: number, locale?: string): string {
  return value.replaceAll("#", new Intl.NumberFormat(locale).format(numericValue))
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return String(value)
}
