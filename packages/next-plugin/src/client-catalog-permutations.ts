import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import { renderCatalogModule } from "@palamedes/core-node";

import {
  MARKER_PATTERN,
  createCatalogCompiler,
  readChunks,
  scanMarkers,
  splitRenderedCatalog,
} from "./client-catalog-chunks";

/*
 * Server-selected per-locale chunk permutations (ADR-031). After compile,
 * every chunk that carries a catalog marker gets one copy per locale with that
 * locale's compiled messages inlined in place of the marker, importers that
 * load such a chunk get copies with rewritten chunk literals, and each client
 * reference manifest gets an adapter that returns the bound locale's chunk
 * paths. The server binds a locale resolver into the manifest at startup
 * (see client-catalog-binding.ts).
 */

/** Installed on the manifest's VM global by the adapter; called by the binding. */
export const CLIENT_CATALOG_BIND_GLOBAL = "__PALAMEDES_CLIENT_CATALOG_BIND";
const ADAPTER_MARKER = "/* palamedes:client-catalog-permutations */";
const CHUNK_LITERAL_PATTERN = /["'](static\/chunks\/[^"'\\\s]+\.js)["']/gu;
const SOURCE_MAP_COMMENT = /\n?\/\/# sourceMappingURL=\S*[ \t]*$/u;
const LOCALE_PATTERN = /^[\w-]+$/u;

export type ChunkGraph = Map<string, { source: string; references: string[] }>;

/** The chunk paths of `static/chunks/*.js` literals in the source that name a known chunk. */
export function chunkReferences(source: string, known: ReadonlySet<string>): string[] {
  const references = new Set<string>();
  for (const [, chunk] of source.matchAll(CHUNK_LITERAL_PATTERN)) {
    if (known.has(chunk!)) references.add(chunk!);
  }
  return [...references];
}

/** The marked chunks plus every chunk that references one of them, transitively. */
export function affectedChunks(graph: ChunkGraph, marked: Iterable<string>): Set<string> {
  const affected = new Set(marked);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, chunk] of graph) {
      if (affected.has(key) || !chunk.references.some((ref) => affected.has(ref))) continue;
      affected.add(key);
      grew = true;
    }
  }
  return affected;
}

/** `static/chunks/x.js` → `static/chunks/x.<locale>-<hash8>.js`. */
export function variantPath(key: string, locale: string, body: string): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
  return key.replace(/\.js$/u, `.${locale}-${hash}.js`);
}

export type Variant = { path: string; body: string };

/*
 * Writes the locale's copy of every affected chunk, dependencies first, so an
 * importer's copy can name its dependency's hashed file. The reverse closure
 * is a tree in practice; a cycle would need hashing by strongly connected
 * component, so it fails instead of guessing.
 */
export function renderVariants(
  graph: ChunkGraph,
  affected: ReadonlySet<string>,
  locale: string,
  messages: ReadonlyMap<string, string>,
): Map<string, Variant> {
  const variants = new Map<string, Variant>();
  const visiting = new Set<string>();
  const render = (key: string): Variant => {
    const done = variants.get(key);
    if (done) return done;
    if (visiting.has(key)) {
      throw new Error(
        `Palamedes client catalog permutations: the client chunks that carry translations import each other in a cycle through ${key}. Permutations need an acyclic chunk graph; move the translated modules out of the cycle.`,
      );
    }
    visiting.add(key);
    const chunk = graph.get(key)!;
    const edits: [number, number, string][] = [];
    for (const match of chunk.source.matchAll(MARKER_PATTERN)) {
      const expression = messages.get(match[1]!);
      if (expression === undefined) {
        throw new Error(
          `Palamedes client catalog permutations: no "${locale}" messages were compiled for module key ${match[1]} in ${key}.`,
        );
      }
      edits.push([match.index, match.index + match[0].length, expression]);
    }
    for (const match of chunk.source.matchAll(CHUNK_LITERAL_PATTERN)) {
      if (!affected.has(match[1]!)) continue;
      const quote = match[0][0]!;
      edits.push([
        match.index,
        match.index + match[0].length,
        `${quote}${render(match[1]!).path}${quote}`,
      ]);
    }
    let body = chunk.source;
    for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
      body = `${body.slice(0, start)}${text}${body.slice(end)}`;
    }
    // Per-variant source maps are not composed yet; a stale pointer would
    // map the copy to the neutral chunk's map.
    body = body.replace(SOURCE_MAP_COMMENT, "\n");
    const variant = { path: variantPath(key, locale, body), body };
    variants.set(key, variant);
    visiting.delete(key);
    return variant;
  };
  for (const key of affected) render(key);
  return variants;
}

/** The compiled messages of one module as a JavaScript expression. */
export function inlineMessageExpression(messages: Record<string, string>): string {
  const { declarations, literal } = splitRenderedCatalog(renderCatalogModule(messages));
  return `(()=>{${declarations}return (${literal});})()`;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
    } else if (ch === "/" && source[index + 1] === "/") {
      const nl = source.indexOf("\n", index + 2);
      index = nl === -1 ? source.length : nl + 1;
    } else if (ch === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      break;
    }
  }
  return index;
}

function scanQuotedStringEnd(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\\") {
      index += 2;
    } else if (ch === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

function scanTemplateLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\\") {
      index += 2;
    } else if (ch === "`") {
      return index + 1;
    } else if (ch === "$" && source[index + 1] === "{") {
      const end = scanBalancedEnd(source, index + 1);
      if (end === -1) return -1;
      index = end;
    } else {
      index += 1;
    }
  }
  return -1;
}

function scanBalancedEnd(source: string, start: number): number {
  const open = source[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  let regexAllowed = true;
  let prevWasDot = false;
  let prevWord = "";
  let prevPrevWord = "";
  const parenConditionStack: boolean[] = [];
  let index = start;
  while (index < source.length) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return -1;
      index = end;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = false;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(source, index);
      if (end === -1) return -1;
      index = end;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = false;
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(source, index);
      if (end !== -1) {
        index = end;
        prevPrevWord = "";
        prevWord = "";
        prevWasDot = false;
        regexAllowed = false;
        continue;
      }
    }
    if ((ch === "+" && source[index + 1] === "+") || (ch === "-" && source[index + 1] === "-")) {
      // Preserve `regexAllowed` across `++`/`--`: after an expression
      // (`counter++ / 2`), `/` is division; in prefix position (`++x`), `/`
      // remains allowed.
      index += 2;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = false;
      continue;
    }
    if (ch === "." || ch === "#") {
      const isSpread = ch === "." && source[index + 1] === "." && source[index + 2] === ".";
      index += isSpread ? 3 : 1;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = !isSpread;
      regexAllowed = isSpread;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < source.length && /[\w$]/u.test(source[index] ?? "")) index += 1;
      const word = source.slice(wordStart, index);
      // Property accesses like `metrics.with(params)`, `fiber.return`, or
      // private fields `#with` are not keywords, so clear `prevWord` and
      // disallow regexes after them. Preserve `prevPrevWord` for `for await (`.
      prevPrevWord = prevWasDot ? "" : prevWord;
      prevWord = prevWasDot ? "" : word;
      regexAllowed = !prevWasDot && REGEX_PRECEDING_KEYWORDS.has(word);
      prevWasDot = false;
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < source.length && /[\w.]/u.test(source[index] ?? "")) index += 1;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = false;
      regexAllowed = false;
      continue;
    }
    if (ch === "(") {
      parenConditionStack.push(
        CONTROL_FLOW_KEYWORDS.has(prevWord) ||
          prevWord === "for" ||
          (prevWord === "await" && prevPrevWord === "for"),
      );
    } else if (ch === ")") {
      const wasCondition = parenConditionStack.pop() ?? false;
      if (ch === close) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
      prevPrevWord = "";
      prevWord = "";
      prevWasDot = false;
      regexAllowed = wasCondition;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
    prevPrevWord = "";
    prevWord = "";
    prevWasDot = false;
    regexAllowed = "([{=,:;!?&|^~+-*/%<>}".includes(ch ?? "");
  }
  return -1;
}

function parseJsStringLiteral(expr: string): string | undefined {
  const trimmed = expr.trim();
  if (trimmed.length < 2) return;
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return;
  if (scanQuotedStringEnd(trimmed, 0) !== trimmed.length) return;
  if (quote === '"') {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to full JS escape decoding (for example `\'` or `\xNN`).
    }
  }
  const inner = trimmed.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < inner.length; index += 1) {
    const ch = inner[index]!;
    if (ch !== "\\") {
      decoded += ch;
      continue;
    }
    index += 1;
    if (index >= inner.length) return;
    const esc = inner[index]!;
    if (esc === "n") decoded += "\n";
    else if (esc === "r") decoded += "\r";
    else if (esc === "t") decoded += "\t";
    else if (esc === "b") decoded += "\b";
    else if (esc === "f") decoded += "\f";
    else if (esc === "v") decoded += "\v";
    else if (esc === "0") decoded += "\0";
    else if (esc === "x") {
      const hex = inner.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/u.test(hex)) return;
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
    } else if (esc === "u") {
      if (inner[index + 1] === "{") {
        const closeBrace = inner.indexOf("}", index + 2);
        if (closeBrace === -1) return;
        const hex = inner.slice(index + 2, closeBrace);
        if (!/^[0-9a-fA-F]+$/u.test(hex)) return;
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10_ff_ff) return;
        decoded += String.fromCodePoint(codePoint);
        index = closeBrace;
      } else {
        const hex = inner.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) return;
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      }
    } else if (esc === "\r") {
      if (inner[index + 1] === "\n") index += 1;
    } else if (esc !== "\n") {
      decoded += esc;
    }
  }
  return decoded;
}

function splitTopLevelArrayElements(source: string, arrayStart: number): string[] | undefined {
  if (source[arrayStart] !== "[") return;
  const arrayEnd = scanBalancedEnd(source, arrayStart);
  if (arrayEnd === -1) return;
  if (skipWhitespaceAndComments(source, arrayEnd) !== source.length) return;
  const elements: string[] = [];
  let index = arrayStart + 1;
  let elemStart = index;
  let regexAllowed = true;
  while (index < arrayEnd - 1) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return;
      index = end;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(source, index);
      if (end === -1) return;
      index = end;
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(source, index);
      if (end !== -1) {
        index = end;
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "[" || ch === "{" || ch === "(") {
      const end = scanBalancedEnd(source, index);
      if (end === -1) return;
      index = end;
      regexAllowed = ch === "{";
      continue;
    }
    if (ch === ",") {
      elements.push(source.slice(elemStart, index).trim());
      index += 1;
      elemStart = index;
      regexAllowed = true;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < arrayEnd - 1 && /[\w$]/u.test(source[index] ?? "")) index += 1;
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(source.slice(wordStart, index));
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < arrayEnd - 1 && /[\w.]/u.test(source[index] ?? "")) index += 1;
      regexAllowed = false;
      continue;
    }
    if ((ch === "+" && source[index + 1] === "+") || (ch === "-" && source[index + 1] === "-")) {
      index += 2;
      continue;
    }
    index += 1;
    regexAllowed = "([{=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }
  const trailing = source.slice(elemStart, arrayEnd - 1).trim();
  if (trailing.length > 0) elements.push(trailing);
  return elements;
}

function parseTopLevelObjectProperties(expr: string): Map<string, string> | undefined {
  const trimmed = expr.trim();
  if (!trimmed.startsWith("{")) return;
  const objectEnd = scanBalancedEnd(trimmed, 0);
  if (objectEnd !== trimmed.length) return;
  const properties = new Map<string, string>();
  let index = 1;
  while (index < objectEnd - 1) {
    index = skipWhitespaceAndComments(trimmed, index);
    if (index >= objectEnd - 1) break;
    let key: string | undefined;
    if (trimmed[index] === '"' || trimmed[index] === "'") {
      const keyEnd = scanQuotedStringEnd(trimmed, index);
      if (keyEnd === -1) return;
      key = parseJsStringLiteral(trimmed.slice(index, keyEnd));
      index = keyEnd;
    } else {
      const keyStart = index;
      while (index < objectEnd - 1 && /[\w$-]/u.test(trimmed[index] ?? "")) index += 1;
      if (index > keyStart) key = trimmed.slice(keyStart, index);
    }
    if (!key) return;
    index = skipWhitespaceAndComments(trimmed, index);
    if (trimmed[index] === "," || index >= objectEnd - 1) {
      // Shorthand property, e.g. `{ tree, page: "...", interopDefault }` in unminified output.
      properties.set(key, key);
      if (trimmed[index] === ",") index += 1;
      continue;
    }
    if (trimmed[index] !== ":") return;
    index = skipWhitespaceAndComments(trimmed, index + 1);
    const valueStart = index;
    let regexAllowed = true;
    while (index < objectEnd - 1) {
      const ch = trimmed[index];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        index += 1;
        continue;
      }
      if (ch === "/" && (trimmed[index + 1] === "/" || trimmed[index + 1] === "*")) {
        index = skipWhitespaceAndComments(trimmed, index);
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = scanQuotedStringEnd(trimmed, index);
        if (end === -1) return;
        index = end;
        regexAllowed = false;
        continue;
      }
      if (ch === "`") {
        const end = scanTemplateLiteralEnd(trimmed, index);
        if (end === -1) return;
        index = end;
        regexAllowed = false;
        continue;
      }
      if (ch === "/" && regexAllowed) {
        const end = scanRegexLiteralEnd(trimmed, index);
        if (end !== -1) {
          index = end;
          regexAllowed = false;
          continue;
        }
      }
      if (ch === "[" || ch === "{" || ch === "(") {
        const end = scanBalancedEnd(trimmed, index);
        if (end === -1) return;
        index = end;
        regexAllowed = ch === "{";
        continue;
      }
      if (ch === ",") break;
      if (/[A-Za-z_$]/u.test(ch ?? "")) {
        const wordStart = index;
        index += 1;
        while (index < objectEnd - 1 && /[\w$]/u.test(trimmed[index] ?? "")) index += 1;
        regexAllowed = REGEX_PRECEDING_KEYWORDS.has(trimmed.slice(wordStart, index));
        continue;
      }
      if (/[0-9]/u.test(ch ?? "")) {
        index += 1;
        while (index < objectEnd - 1 && /[\w.]/u.test(trimmed[index] ?? "")) index += 1;
        regexAllowed = false;
        continue;
      }
      if (
        (ch === "+" && trimmed[index + 1] === "+") ||
        (ch === "-" && trimmed[index + 1] === "-")
      ) {
        index += 2;
        continue;
      }
      index += 1;
      regexAllowed = "([{=,:;!?&|^~+-*/%<>".includes(ch ?? "");
    }
    properties.set(key, trimmed.slice(valueStart, index).trim());
    if (trimmed[index] === ",") index += 1;
  }
  return properties;
}

function walkCompiledLoaderTree(
  source: string,
  arrayStart: number,
  seenOptionalLocale: boolean,
): boolean | undefined {
  const elements = splitTopLevelArrayElements(source, arrayStart);
  if (!elements || elements.length < 3) return;
  const segment = parseJsStringLiteral(elements[0]!);
  if (segment === undefined) return;
  const parallelRoutes = parseTopLevelObjectProperties(elements[1]!);
  const modules = parseTopLevelObjectProperties(elements[2]!);
  if (!parallelRoutes || !modules) return;

  const hasOptionalLocale = seenOptionalLocale || segment === "[[...locale]]";
  if (modules.has("layout")) {
    const layoutExpr = modules.get("layout")!;
    const layoutStart = skipWhitespaceAndComments(layoutExpr, 0);
    const trimmedLayout = layoutExpr.slice(layoutStart).trim();
    if (trimmedLayout === "undefined" || /^void\s+0$/u.test(trimmedLayout)) {
      // Explicit `undefined` layout value: continue down `children`, matching
      // Next's `if (typeof layout !== 'undefined')` check in `getRootParamsImpl()`.
    } else if (layoutExpr[layoutStart] === "[") {
      const layoutEnd = scanBalancedEnd(layoutExpr, layoutStart);
      if (
        layoutEnd === -1 ||
        skipWhitespaceAndComments(layoutExpr, layoutEnd) !== layoutExpr.length
      ) {
        return;
      }
      return hasOptionalLocale;
    } else {
      // Dynamic or non-tuple layout expression: inconclusive.
      return;
    }
  }
  const childrenExpr = parallelRoutes.get("children");
  if (childrenExpr === undefined) return;
  const childStart = skipWhitespaceAndComments(childrenExpr, 0);
  if (childrenExpr[childStart] !== "[") return;
  return walkCompiledLoaderTree(childrenExpr, childStart, hasOptionalLocale);
}

type ScopeFrame = {
  binding?: { value: string | null; blockScoped: boolean; isConst: boolean };
  tainted: boolean;
  sawExportSetter?: boolean;
  declKind?: "let" | "const" | "var";
  exprDepth: number;
  pendingCondition: boolean;
  conditionalStmt: boolean;
};

const CONTROL_FLOW_KEYWORDS = new Set(["if", "while", "switch", "with"]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "default",
  "in",
  "instanceof",
  "typeof",
  "void",
  "delete",
  "new",
  "yield",
  "await",
  "else",
  "do",
]);

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function scanRegexLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\\") {
      const escaped = source[index + 1];
      if (
        escaped === undefined ||
        escaped === "\n" ||
        escaped === "\r" ||
        escaped === "\u2028" ||
        escaped === "\u2029"
      ) {
        return -1;
      }
      index += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") return -1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      index += 1;
      while (index < source.length && /[a-z]/iu.test(source[index] ?? "")) index += 1;
      return index;
    }
    index += 1;
  }
  return -1;
}

/**
 * Resolves an identifier bound to an array literal in the same straight-line
 * scope enclosing `objectStart`. Ignores `let`/`const` bindings confined to
 * closed sibling blocks (such as helper functions or earlier modules in the
 * same chunk) and returns `undefined` whenever scope identity or mutation is
 * uncertain so callers fall back to inspecting the source tree.
 */
function resolveIdentifierArrayInScope(
  source: string,
  objectStart: number,
  objectEnd: number,
  ident: string,
  moduleParam?: string,
): string | undefined {
  const scopeStack: ScopeFrame[] = [
    { tainted: false, exprDepth: 0, pendingCondition: false, conditionalStmt: false },
  ];
  const identWord = new RegExp(
    `(?:(?<![\\w$.])|\\.\\.\\.)${escapeRegExpLiteral(ident)}(?![\\w$])`,
    "u",
  );
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let prevNonWsChar = "";
  let regexAllowed = true;
  let index = 0;

  const scanRange = (limit: number, stopBelowDepth: number): boolean => {
    while (index < limit) {
      if (stopBelowDepth > 0 && scopeStack.length < stopBelowDepth) return true;
      const ch = source[index];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        index += 1;
        continue;
      }
      if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
        index = skipWhitespaceAndComments(source, index);
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = scanQuotedStringEnd(source, index);
        if (end === -1) return false;
        index = end;
        prevTokenKind = "other";
        prevNonWsChar = ch;
        regexAllowed = false;
        continue;
      }
      if (ch === "`") {
        const end = scanTemplateLiteralEnd(source, index);
        if (end === -1) return false;
        const literal = source.slice(index, end);
        // Executable `${...}` substitutions inside a template literal can mutate
        // `ident` in place (e.g. `${(t[2] = {}, "")}`). Treat any interpolation
        // mentioning `ident` as inconclusive unless confined to this block's own
        // `let`/`const` binding.
        if (literal.includes("${") && identWord.test(literal)) {
          const currentFrame = scopeStack.at(-1)!;
          if (currentFrame.binding?.blockScoped) {
            currentFrame.binding = { value: null, blockScoped: true, isConst: false };
          } else {
            currentFrame.tainted = true;
          }
        }
        index = end;
        prevTokenKind = "other";
        prevNonWsChar = "`";
        regexAllowed = false;
        continue;
      }
      if (ch === "/" && regexAllowed) {
        const end = scanRegexLiteralEnd(source, index);
        if (end !== -1) {
          index = end;
          prevTokenKind = "other";
          prevNonWsChar = "/";
          regexAllowed = false;
          continue;
        }
      }

      const top = scopeStack.at(-1)!;
      if (ch === "{") {
        const isDestructuringDecl =
          top.exprDepth === 0 &&
          (prevTokenKind === "decl" || (prevTokenKind === "comma" && top.declKind !== undefined));
        if (isDestructuringDecl) {
          const end = scanBalancedEnd(source, index);
          if (end === -1 || end > limit) return false;
          // Destructuring patterns like `const { t: label } = meta` mention `t`
          // as a property key rather than binding a local `t`. Taint instead of
          // assuming a block-scoped shadow so later writes to outer `t` are never
          // discarded.
          if (identWord.test(source.slice(index + 1, end - 1))) {
            top.tainted = true;
          }
          index = end;
          prevTokenKind = "other";
          prevNonWsChar = "}";
          regexAllowed = false;
          continue;
        }
        top.conditionalStmt = false;
        top.pendingCondition = false;
        scopeStack.push({
          tainted: false,
          exprDepth: 0,
          pendingCondition: false,
          conditionalStmt: false,
        });
        index += 1;
        prevTokenKind = "other";
        prevNonWsChar = "{";
        regexAllowed = true;
        continue;
      }
      if (ch === "}") {
        if (scopeStack.length <= 1) return false;
        const closed = scopeStack.pop()!;
        if (closed.tainted || (closed.binding !== undefined && !closed.binding.blockScoped)) {
          scopeStack.at(-1)!.tainted = true;
        }
        if (closed.sawExportSetter && !closed.binding?.blockScoped) {
          scopeStack.at(-1)!.sawExportSetter = true;
        }
        index += 1;
        prevTokenKind = "other";
        prevNonWsChar = "}";
        regexAllowed = true;
        continue;
      }
      if (ch === "(" || ch === "[") {
        const isArrayDestructuringDecl =
          ch === "[" &&
          top.exprDepth === 0 &&
          (prevTokenKind === "decl" || (prevTokenKind === "comma" && top.declKind !== undefined));
        if (isArrayDestructuringDecl) {
          const end = scanBalancedEnd(source, index);
          if (end === -1 || end > limit) return false;
          if (identWord.test(source.slice(index + 1, end - 1))) {
            top.tainted = true;
          }
          index = end;
          prevTokenKind = "other";
          prevNonWsChar = "]";
          regexAllowed = false;
          continue;
        }
        top.exprDepth += 1;
        index += 1;
        prevTokenKind = "other";
        prevNonWsChar = ch;
        regexAllowed = true;
        continue;
      }
      if (ch === ")" || ch === "]") {
        if (top.exprDepth > 0) top.exprDepth -= 1;
        let closedCondition = false;
        if (ch === ")" && top.exprDepth === 0 && top.pendingCondition) {
          top.pendingCondition = false;
          top.conditionalStmt = true;
          closedCondition = true;
        }
        index += 1;
        prevTokenKind = "other";
        prevNonWsChar = ch;
        regexAllowed = closedCondition;
        continue;
      }
      if (ch === ";") {
        if (top.exprDepth === 0) {
          top.declKind = undefined;
          top.conditionalStmt = false;
          top.pendingCondition = false;
        }
        index += 1;
        prevTokenKind = "other";
        prevNonWsChar = ";";
        regexAllowed = true;
        continue;
      }
      if (ch === ",") {
        index += 1;
        prevTokenKind = "comma";
        prevNonWsChar = ",";
        regexAllowed = true;
        continue;
      }
      if (ch === ".") {
        // Spread/rest (`...ident`) references the identifier rather than a
        // property access, so it must not set `prevTokenKind = "dot"`.
        if (source[index + 1] === "." && source[index + 2] === ".") {
          index += 3;
          prevTokenKind = "other";
          prevNonWsChar = ".";
          regexAllowed = true;
          continue;
        }
        index += 1;
        prevTokenKind = "dot";
        prevNonWsChar = ".";
        regexAllowed = false;
        continue;
      }

      if (/[A-Za-z_$]/u.test(ch ?? "")) {
        const wordStart = index;
        index += 1;
        while (index < limit && /[\w$]/u.test(source[index] ?? "")) index += 1;
        const word = source.slice(wordStart, index);
        if (prevTokenKind !== "dot") {
          // With `experimental.turbopackModuleFragments: true`, Turbopack may
          // register `ctx.s([..., "tree", () => tree, a => tree = a])` either
          // before or after `const tree = [...]` (for example before init when
          // unminified with unused-export removal disabled). A `const` binding
          // cannot be reassigned by the generated setter (calling it throws
          // TypeError), so skip verified read-only/const-setter export calls
          // here and enforce `finalFrame.binding.isConst === true` below.
          if (
            moduleParam !== undefined &&
            (stopBelowDepth === 0 || scopeStack.length === stopBelowDepth) &&
            top.exprDepth === 0 &&
            word === moduleParam
          ) {
            const afterParam = skipWhitespaceAndComments(source, index);
            if (source[afterParam] === ".") {
              const afterDot = skipWhitespaceAndComments(source, afterParam + 1);
              if (source[afterDot] === "s") {
                const afterS = skipWhitespaceAndComments(source, afterDot + 1);
                if (source[afterS] === "(") {
                  const callEnd = scanBalancedEnd(source, afterS);
                  const arrStart = skipWhitespaceAndComments(source, afterS + 1);
                  const arrEnd =
                    callEnd !== -1 && source[arrStart] === "["
                      ? scanBalancedEnd(source, arrStart)
                      : -1;
                  if (callEnd !== -1 && arrEnd !== -1 && arrEnd <= callEnd - 1) {
                    const elements = splitTopLevelArrayElements(source.slice(arrStart, arrEnd), 0);
                    const bindings = elements
                      ? parseTurbopackEsmExportBindings(elements)
                      : undefined;
                    let usesSetter = false;
                    if (
                      bindings &&
                      bindings.every((binding) => {
                        const mentionsIdent =
                          binding.kind === "value"
                            ? identWord.test(binding.expr)
                            : identWord.test(binding.getterExpr) ||
                              (binding.setterExpr !== undefined &&
                                identWord.test(binding.setterExpr));
                        if (!mentionsIdent) return true;
                        if (binding.kind === "value") {
                          return (
                            top.binding?.value !== undefined &&
                            top.binding.value !== null &&
                            stripOuterParens(binding.expr) === ident
                          );
                        }
                        if (unwrapExportGetter(binding.getterExpr) !== ident) return false;
                        if (binding.setterExpr !== undefined) {
                          if (!isSimpleSetterForIdentifier(binding.setterExpr, ident)) return false;
                          usesSetter = true;
                        }
                        return true;
                      })
                    ) {
                      if (usesSetter) top.sawExportSetter = true;
                      index = callEnd;
                      prevTokenKind = "other";
                      prevNonWsChar = ")";
                      regexAllowed = false;
                      continue;
                    }
                  }
                }
              }
            }
          }
          if (top.exprDepth === 0 && (word === "let" || word === "const" || word === "var")) {
            top.declKind = word;
            prevTokenKind = "decl";
            prevNonWsChar = word.at(-1) ?? "";
            regexAllowed = false;
            continue;
          }
          if (top.exprDepth === 0 && (CONTROL_FLOW_KEYWORDS.has(word) || word === "for")) {
            top.pendingCondition = true;
            prevTokenKind = "other";
            prevNonWsChar = word.at(-1) ?? "";
            regexAllowed = false;
            continue;
          }
          if (top.exprDepth === 0 && (word === "else" || word === "do")) {
            top.conditionalStmt = true;
            prevTokenKind = "other";
            prevNonWsChar = word.at(-1) ?? "";
            regexAllowed = true;
            continue;
          }
          if (word === ident) {
            const isDeclarator =
              top.exprDepth === 0 &&
              (prevTokenKind === "decl" ||
                (prevTokenKind === "comma" && top.declKind !== undefined));
            const afterWord = skipWhitespaceAndComments(source, index);
            if (
              afterWord < limit &&
              source[afterWord] === "=" &&
              source[afterWord + 1] !== "=" &&
              source[afterWord + 1] !== ">"
            ) {
              const blockScoped =
                isDeclarator && (top.declKind === "let" || top.declKind === "const");
              const rhsStart = skipWhitespaceAndComments(source, afterWord + 1);
              // Accept only a single, unconditional declaration initializer whose
              // entire right-hand side is an array literal (not chained or
              // computed like `[...].with(...)`) with no prior or later writes.
              let value: string | null = null;
              if (
                isDeclarator &&
                !top.conditionalStmt &&
                top.binding === undefined &&
                rhsStart < limit &&
                source[rhsStart] === "["
              ) {
                const arrayEnd = scanBalancedEnd(source, rhsStart);
                if (arrayEnd !== -1 && arrayEnd <= limit) {
                  const afterArray = skipWhitespaceAndComments(source, arrayEnd);
                  const nextChar = afterArray < limit ? source[afterArray] : undefined;
                  const hasNewline = /[\r\n]/u.test(source.slice(arrayEnd, afterArray));
                  const endsInitializer =
                    afterArray >= limit ||
                    nextChar === ";" ||
                    nextChar === "," ||
                    nextChar === "}" ||
                    (hasNewline && !/^[.[(?+\-*/%&|^=<>!:]/u.test(nextChar ?? ""));
                  if (endsInitializer) {
                    value = source.slice(rhsStart, arrayEnd);
                  }
                  index = arrayEnd;
                }
              }
              top.binding = {
                value,
                blockScoped: blockScoped || Boolean(top.binding?.blockScoped),
                isConst: isDeclarator && top.declKind === "const" && value !== null,
              };
            } else if (isDeclarator) {
              top.binding = {
                value: null,
                blockScoped: top.declKind === "let" || top.declKind === "const",
                isConst: false,
              };
            } else {
              const isObjectPropertyKey =
                (prevNonWsChar === "{" || prevNonWsChar === ",") &&
                afterWord < limit &&
                source[afterWord] === ":";
              if (!isObjectPropertyKey) {
                // Any intervening or hoisted reference to `ident` (member write,
                // mutating method call, spread, aliasing, or function call) can
                // mutate the array in place; treat it as inconclusive unless
                // confined to this block's own `let`/`const` binding.
                if (top.binding?.blockScoped) {
                  top.binding = { value: null, blockScoped: true, isConst: false };
                } else {
                  top.tainted = true;
                }
              }
            }
          }
        }
        prevTokenKind = "other";
        prevNonWsChar = word.at(-1) ?? "";
        regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
        continue;
      }

      if (/[0-9]/u.test(ch ?? "")) {
        index += 1;
        while (index < limit && /[\w.]/u.test(source[index] ?? "")) index += 1;
        prevTokenKind = "other";
        prevNonWsChar = "0";
        regexAllowed = false;
        continue;
      }

      if ((ch === "+" && source[index + 1] === "+") || (ch === "-" && source[index + 1] === "-")) {
        index += 2;
        prevTokenKind = "other";
        prevNonWsChar = ch;
        continue;
      }
      index += 1;
      prevTokenKind = "other";
      prevNonWsChar = ch ?? "";
      regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
    }
    return true;
  };

  if (!scanRange(objectStart, 0)) return;

  // Only accept an initializer declared in the same straight-line scope as the
  // entrypoint call; captured outer bindings inside a nested function/block can
  // be mutated after the declaration and before deferred execution.
  const targetDepth = scopeStack.length;
  const finalFrame = scopeStack.at(-1)!;
  if (
    finalFrame.tainted ||
    !finalFrame.binding?.value ||
    (finalFrame.sawExportSetter && !finalFrame.binding.isConst)
  ) {
    return;
  }
  const candidateValue = finalFrame.binding.value;

  // Also scan the remainder of the enclosing scope after the entrypoint call so
  // hoisted functions declared later in the same scope (which may have been
  // called before the entrypoint) cannot mutate `ident` undetected.
  index = objectEnd;
  prevTokenKind = "other";
  prevNonWsChar = "}";
  regexAllowed = false;
  if (!scanRange(source.length, targetDepth)) return;
  if (
    finalFrame.tainted ||
    finalFrame.binding?.value !== candidateValue ||
    (finalFrame.sawExportSetter && !finalFrame.binding.isConst)
  ) {
    return;
  }
  return candidateValue;
}

type EntrypointExportName = "__next_app__" | "routeModule" | "handler";

function normalizeTurbopackModuleId(rawLiteral: string): string | undefined {
  const trimmed = rawLiteral.trim();
  if (/^\d+(?:\.\d+)?(?:[eE]\+?\d+)?$/u.test(trimmed)) {
    const numericValue = Number(trimmed);
    if (Number.isSafeInteger(numericValue) && numericValue >= 0) {
      return `n:${numericValue}`;
    }
    return;
  }
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const decoded = parseJsStringLiteral(trimmed);
    if (decoded !== undefined) return `s:${decoded}`;
  }
  return;
}

function formatNormalizedTurbopackModuleIdLiteral(normalizedId: string): string {
  return normalizedId.startsWith("n:")
    ? normalizedId.slice(2)
    : JSON.stringify(normalizedId.slice(2));
}

type EnclosingModuleContext = {
  scopeStart: number;
  scopeEnd: number;
  isTopLevel: boolean;
  moduleParam?: string;
  moduleIds?: string[];
};

function findEnclosingModuleContext(
  source: string,
  targetOffset: number,
): EnclosingModuleContext | undefined {
  const braceStack: number[] = [];
  let prevNonWsChar = "";
  let regexAllowed = true;
  let index = 0;

  while (index < targetOffset) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return;
      index = end;
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(source, index);
      if (end === -1) return;
      index = end;
      prevNonWsChar = "`";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(source, index);
      if (end !== -1) {
        index = end;
        prevNonWsChar = "/";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      braceStack.push(index);
      index += 1;
      prevNonWsChar = "{";
      regexAllowed = true;
      continue;
    }
    if (ch === "}") {
      if (braceStack.length === 0) return;
      braceStack.pop();
      index += 1;
      prevNonWsChar = "}";
      regexAllowed = true;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < targetOffset && /[\w$]/u.test(source[index] ?? "")) index += 1;
      const word = source.slice(wordStart, index);
      prevNonWsChar = word.at(-1) ?? "";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < targetOffset && /[\w.]/u.test(source[index] ?? "")) index += 1;
      prevNonWsChar = "0";
      regexAllowed = false;
      continue;
    }
    if ((ch === "+" && source[index + 1] === "+") || (ch === "-" && source[index + 1] === "-")) {
      index += 2;
      prevNonWsChar = ch;
      continue;
    }
    index += 1;
    prevNonWsChar = ch ?? "";
    regexAllowed = "([{=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  if (braceStack.length === 0) {
    return { scopeStart: 0, scopeEnd: source.length, isTopLevel: true };
  }
  let openBrace: number | undefined;
  if (braceStack.length === 1) {
    openBrace = braceStack[0]!;
  } else if (braceStack.length === 2) {
    // Next 16.4.1 can wrap strict-mode factory tables in a leading zero-arg IIFE
    // (`module.exports = [(() => { "use strict"; return [id, factory, ...]; })(), ...]`).
    const outerBrace = braceStack[0]!;
    const outerPrefix = source.slice(0, outerBrace);
    if (
      /(?:^|[^\w$])(?:\(\s*\)\s*=>|function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*\))\s*$/u.test(
        outerPrefix,
      )
    ) {
      const outerClose = scanBalancedEnd(source, outerBrace);
      if (outerClose !== -1) {
        let afterOuter = skipWhitespaceAndComments(source, outerClose);
        if (source[afterOuter] === ")") {
          afterOuter = skipWhitespaceAndComments(source, afterOuter + 1);
        }
        if (source[afterOuter] === "(") {
          openBrace = braceStack[1]!;
        }
      }
    }
  }
  if (openBrace === undefined) return;
  const closeBraceEnd = scanBalancedEnd(source, openBrace);
  if (closeBraceEnd === -1) return;

  const prefix = source.slice(0, openBrace);
  const fnHeaderMatch =
    /(?:^|[^\w$])(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*$/u.exec(
      prefix,
    ) ??
    /(?:^|[^\w$])function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)\s*$/u.exec(
      prefix,
    );
  const moduleParam = fnHeaderMatch?.[1] ?? fnHeaderMatch?.[2];
  if (!fnHeaderMatch || !moduleParam) return;

  const fnStart =
    fnHeaderMatch.index +
    (fnHeaderMatch[0].startsWith("(") || /^[A-Za-z_$]/u.test(fnHeaderMatch[0]) ? 0 : 1);
  // Turbopack registers one or more consecutive module IDs before each factory
  // (for example `[3042, 77420, (a, b) => { ... }]`, or parenthesized in
  // unminified builds: `[82713, ((__turbopack_context__) => { ... })]`).
  // Unwrap any leading grouping parens and collect the full ID group.
  const moduleIds: string[] = [];
  let cursorText = source.slice(0, fnStart).replace(/(?:\s|\()+$/u, "");
  while (true) {
    const idMatch =
      /(?:^|[[,])\s*(\d+(?:\.\d+)?(?:[eE]\+?\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*$/u.exec(
        cursorText,
      );
    if (!idMatch) break;
    const normalizedId = normalizeTurbopackModuleId(idMatch[1]!);
    if (!normalizedId) break;
    moduleIds.unshift(normalizedId);
    const matched = idMatch[0];
    const keepLeading = matched.startsWith("[") || matched.startsWith(",") ? 1 : 0;
    cursorText = cursorText.slice(0, idMatch.index + keepLeading);
  }
  return {
    scopeStart: openBrace + 1,
    scopeEnd: closeBraceEnd - 1,
    isTopLevel: false,
    moduleParam,
    moduleIds: moduleIds.length > 0 ? moduleIds : undefined,
  };
}

function endsInitializerAt(source: string, exprEnd: number, limit = source.length): boolean {
  const after = skipWhitespaceAndComments(source, exprEnd);
  if (after >= limit) return true;
  const nextChar = source[after];
  if (nextChar === ";" || nextChar === "," || nextChar === "}") return true;
  const hasNewline = /[\r\n]/u.test(source.slice(exprEnd, after));
  return hasNewline && !/^[.[(?+\-*/%&|^=<>!:]/u.test(nextChar ?? "");
}

function extractEntrypointCallBinding(
  scopeSource: string,
  callParenOffset: number,
  afterCloseParenOffset: number,
):
  | {
      entrypointVar: string;
      varStart: number;
      calleeText: string;
      declKind: "let" | "const" | "var";
    }
  | undefined {
  if (!endsInitializerAt(scopeSource, afterCloseParenOffset)) return;

  let declKind: "let" | "const" | "var" | undefined;
  let exprDepth = 0;
  let pendingCondition = false;
  let conditionalStmt = false;
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let regexAllowed = true;
  let index = 0;

  while (index < callParenOffset) {
    const ch = scopeSource[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (scopeSource[index + 1] === "/" || scopeSource[index + 1] === "*")) {
      index = skipWhitespaceAndComments(scopeSource, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(scopeSource, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(scopeSource, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(scopeSource, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      const end = scanBalancedEnd(scopeSource, index);
      if (end === -1 || end > callParenOffset) return;
      index = end;
      prevTokenKind = "other";
      conditionalStmt = false;
      pendingCondition = false;
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (exprDepth > 0) exprDepth -= 1;
      let closedCondition = false;
      if (ch === ")" && exprDepth === 0 && pendingCondition) {
        pendingCondition = false;
        conditionalStmt = true;
        closedCondition = true;
      }
      index += 1;
      prevTokenKind = "other";
      regexAllowed = closedCondition;
      continue;
    }
    if (ch === ";") {
      if (exprDepth === 0) {
        declKind = undefined;
        conditionalStmt = false;
        pendingCondition = false;
      }
      index += 1;
      prevTokenKind = "other";
      regexAllowed = true;
      continue;
    }
    if (ch === ",") {
      index += 1;
      prevTokenKind = "comma";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      if (scopeSource[index + 1] === "." && scopeSource[index + 2] === ".") {
        index += 3;
        prevTokenKind = "other";
        regexAllowed = true;
        continue;
      }
      index += 1;
      prevTokenKind = "dot";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < callParenOffset && /[\w$]/u.test(scopeSource[index] ?? "")) index += 1;
      const word = scopeSource.slice(wordStart, index);
      if (prevTokenKind !== "dot") {
        if (exprDepth === 0 && (word === "let" || word === "const" || word === "var")) {
          declKind = word;
          prevTokenKind = "decl";
          regexAllowed = false;
          continue;
        }
        if (exprDepth === 0 && (CONTROL_FLOW_KEYWORDS.has(word) || word === "for")) {
          pendingCondition = true;
          prevTokenKind = "other";
          regexAllowed = false;
          continue;
        }
        if (exprDepth === 0 && (word === "else" || word === "do")) {
          conditionalStmt = true;
          prevTokenKind = "other";
          regexAllowed = true;
          continue;
        }
        const isDeclarator =
          exprDepth === 0 &&
          !conditionalStmt &&
          (prevTokenKind === "decl" || (prevTokenKind === "comma" && declKind !== undefined));
        if (isDeclarator) {
          const afterWord = skipWhitespaceAndComments(scopeSource, index);
          if (
            afterWord < callParenOffset &&
            scopeSource[afterWord] === "=" &&
            scopeSource[afterWord + 1] !== "=" &&
            scopeSource[afterWord + 1] !== ">"
          ) {
            const rhsStart = skipWhitespaceAndComments(scopeSource, afterWord + 1);
            if (rhsStart < callParenOffset) {
              let calleeEnd = -1;
              if (scopeSource[rhsStart] === "(") {
                const parenEnd = scanBalancedEnd(scopeSource, rhsStart);
                if (
                  parenEnd !== -1 &&
                  skipWhitespaceAndComments(scopeSource, parenEnd) === callParenOffset
                ) {
                  calleeEnd = parenEnd;
                }
              } else if (/[A-Za-z_$]/u.test(scopeSource[rhsStart] ?? "")) {
                let cursor = rhsStart;
                while (cursor < callParenOffset) {
                  while (cursor < callParenOffset && /[\w$]/u.test(scopeSource[cursor] ?? "")) {
                    cursor += 1;
                  }
                  const afterPart = skipWhitespaceAndComments(scopeSource, cursor);
                  if (afterPart === callParenOffset) {
                    calleeEnd = cursor;
                    break;
                  }
                  if (scopeSource[afterPart] !== ".") break;
                  const nextPart = skipWhitespaceAndComments(scopeSource, afterPart + 1);
                  if (
                    nextPart >= callParenOffset ||
                    !/[A-Za-z_$]/u.test(scopeSource[nextPart] ?? "")
                  ) {
                    break;
                  }
                  cursor = nextPart;
                }
              }
              if (calleeEnd !== -1 && declKind !== undefined) {
                return {
                  entrypointVar: word,
                  varStart: wordStart,
                  calleeText: scopeSource.slice(rhsStart, calleeEnd).trim(),
                  declKind,
                };
              }
            }
          }
        }
      }
      prevTokenKind = "other";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < callParenOffset && /[\w.]/u.test(scopeSource[index] ?? "")) index += 1;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (
      (ch === "+" && scopeSource[index + 1] === "+") ||
      (ch === "-" && scopeSource[index + 1] === "-")
    ) {
      index += 2;
      prevTokenKind = "other";
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }
  return;
}

function stripOuterParens(expr: string): string {
  let trimmed = expr.trim();
  while (trimmed.startsWith("(") && scanBalancedEnd(trimmed, 0) === trimmed.length) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function unwrapExportGetterBody(expr: string): string | undefined {
  const trimmed = stripOuterParens(expr);
  const arrowSimple = /^\(\s*\)\s*=>\s*([\s\S]+)$/u.exec(trimmed);
  if (arrowSimple) {
    const body = arrowSimple[1]!.trim();
    if (!body.startsWith("{")) return stripOuterParens(body);
  }
  const blockReturn =
    /^(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{\s*return\s+([\s\S]+?)\s*;?\s*\}$/u.exec(trimmed);
  return blockReturn ? stripOuterParens(blockReturn[1]!) : undefined;
}

function unwrapExportGetter(expr: string): string | undefined {
  const body = unwrapExportGetterBody(expr);
  if (!body) return;
  if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?$/u.test(body)) {
    return body.replace(/\s+/gu, "");
  }
  return;
}

function isAssignmentOperatorAt(source: string, offset: number): boolean {
  const ch = source[offset];
  if (!ch) return false;
  if (ch === "=" && source[offset + 1] !== "=" && source[offset + 1] !== ">") return true;
  if ((ch === "+" && source[offset + 1] === "+") || (ch === "-" && source[offset + 1] === "-")) {
    return true;
  }
  if (["+", "-", "*", "/", "%", "&", "|", "^"].includes(ch) && source[offset + 1] === "=") {
    return true;
  }
  const three = source.slice(offset, offset + 3);
  if (
    three === "**=" ||
    three === "<<=" ||
    three === ">>=" ||
    three === "&&=" ||
    three === "||=" ||
    three === "??="
  ) {
    return true;
  }
  return source.slice(offset, offset + 4) === ">>>=";
}

const NEXT_APP_PAGE_RUNTIME_SPECIFIER =
  /^next\/dist\/(?:esm\/)?build\/templates\/app-page-runtime(?:\.js)?$/u;

const NEXT_APP_PAGE_EXTERNAL_SPECIFIER =
  /^next\/dist\/(?:compiled\/next-server\/app-page(?:-turbo)?(?:-experimental)?\.runtime\.(?:prod|dev)\.js|server\/route-modules\/app-page\/module\.compiled(?:\.js)?)$/u;

/** Returns the factory source, `null` when conflicting factories or unparsed chunks exist, or `undefined` when absent. */
type TurbopackModuleResolver = (moduleId: string) => string | null | undefined;
type TurbopackFactoryGroup = { ids: string[]; factory: string };
type TurbopackExtractedChunk = { groups: TurbopackFactoryGroup[] };
type TurbopackChunkModuleCache = Map<string, TurbopackExtractedChunk | null>;

const RUNTIME_EXPORT_VERIFY_CACHE = new WeakMap<
  TurbopackChunkModuleCache,
  Map<string, string | null>
>();
const RUNTIME_NESTED_TABLE_CACHE = new WeakMap<TurbopackChunkModuleCache, Map<string, boolean>>();
const RESOLVER_RUNTIME_VERIFY_CACHE = new WeakMap<
  TurbopackModuleResolver,
  Map<string, string | null>
>();

type JsAstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

type BabelParserModule = {
  parse(
    input: string,
    options: {
      sourceType: "script" | "module";
      allowReturnOutsideFunction?: boolean;
      allowSuperOutsideMethod?: boolean;
      allowImportExportEverywhere?: boolean;
      allowAwaitOutsideFunction?: boolean;
      allowUndeclaredExports?: boolean;
      plugins?: readonly string[];
    },
  ): { program?: JsAstNode };
};

const BABEL_PARSER_PLUGINS = [
  "explicitResourceManagement",
  "importAttributes",
  "deferredImportEvaluation",
  "sourcePhaseImports",
] as const;

let cachedBabelParser: BabelParserModule | undefined;

function loadBabelParser(resolveFromDir?: string): BabelParserModule | null {
  if (cachedBabelParser) return cachedBabelParser;
  const attempts: Array<() => BabelParserModule> = [];
  if (resolveFromDir) {
    attempts.push(
      () =>
        createRequire(path.join(resolveFromDir, "package.json"))(
          "next/dist/compiled/babel/parser.js",
        ) as BabelParserModule,
    );
  }
  attempts.push(
    () => createRequire(import.meta.url)("next/dist/compiled/babel/parser.js") as BabelParserModule,
    () =>
      createRequire(path.join(process.cwd(), "package.json"))(
        "next/dist/compiled/babel/parser.js",
      ) as BabelParserModule,
  );
  for (const attempt of attempts) {
    try {
      const mod = attempt();
      if (mod && typeof mod.parse === "function") {
        cachedBabelParser = mod;
        return mod;
      }
    } catch {
      // Try next resolution root.
    }
  }
  return null;
}

function parseJsProgram(source: string, resolveFromDir?: string): JsAstNode | null {
  const parser = loadBabelParser(resolveFromDir);
  if (!parser) return null;
  try {
    const file = parser.parse(source, {
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      plugins: BABEL_PARSER_PLUGINS,
    });
    return file.program ?? null;
  } catch {
    try {
      const file = parser.parse(source, {
        sourceType: "module",
        allowReturnOutsideFunction: true,
        allowSuperOutsideMethod: true,
        allowImportExportEverywhere: true,
        allowAwaitOutsideFunction: true,
        allowUndeclaredExports: true,
        plugins: BABEL_PARSER_PLUGINS,
      });
      return file.program ?? null;
    } catch {
      return null;
    }
  }
}

function isAstNode(value: unknown): value is JsAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function getStringLiteralValue(node: JsAstNode): string | undefined {
  if (
    (node.type === "StringLiteral" || node.type === "Literal") &&
    typeof node.value === "string"
  ) {
    return node.value;
  }
  return;
}

function getNumberLiteralValue(node: JsAstNode): number | undefined {
  if (
    (node.type === "NumericLiteral" || node.type === "Literal") &&
    typeof node.value === "number" &&
    Number.isFinite(node.value)
  ) {
    return node.value;
  }
  return;
}

function walkJsAst(
  node: JsAstNode,
  parent: JsAstNode | undefined,
  visit: (node: JsAstNode, parent: JsAstNode | undefined) => boolean | void,
): void {
  if (visit(node, parent) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "type" ||
      key === "start" ||
      key === "end" ||
      key === "loc" ||
      key === "extra" ||
      key === "comments" ||
      key === "tokens" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) walkJsAst(item, node, visit);
      }
    } else if (isAstNode(value)) {
      walkJsAst(value, node, visit);
    }
  }
}

function isModuleExportsMember(node: JsAstNode): boolean {
  if (node.type !== "MemberExpression") return false;
  const obj = node.object;
  const prop = node.property;
  if (!isAstNode(obj) || !isAstNode(prop)) return false;
  if (obj.type !== "Identifier" || obj.name !== "module") return false;
  if (node.computed) {
    return getStringLiteralValue(prop) === "exports";
  }
  return prop.type === "Identifier" && prop.name === "exports";
}

function unwrapTurbopackArrayNode(node: JsAstNode): JsAstNode | undefined {
  if (node.type === "ArrayExpression") return node;
  // Strict-mode IIFE table: `(() => { "use strict"; return [...]; })()` or
  // `(function() { "use strict"; return [...]; })()`.
  if (node.type !== "CallExpression") return;
  const args = node.arguments;
  if (!Array.isArray(args) || args.length !== 0) return;
  const callee = node.callee;
  if (!isAstNode(callee)) return;
  if (callee.type !== "ArrowFunctionExpression" && callee.type !== "FunctionExpression") return;
  const params = callee.params;
  if (!Array.isArray(params) || params.length !== 0 || callee.async || callee.generator) return;
  const fnBody = callee.body;
  if (!isAstNode(fnBody)) return;
  if (fnBody.type === "ArrayExpression") return fnBody;
  if (fnBody.type !== "BlockStatement" || !Array.isArray(fnBody.body)) return;
  if (Array.isArray(fnBody.directives)) {
    for (const dir of fnBody.directives as JsAstNode[]) {
      const dirVal = isAstNode(dir.value) ? dir.value.value : undefined;
      if (dirVal !== "use strict") return;
    }
  }
  const statements = (fnBody.body as JsAstNode[]).filter((stmt) => {
    if (stmt.type === "EmptyStatement") return false;
    if (stmt.type === "ExpressionStatement") {
      if (stmt.directive === "use strict") return false;
      const expr = stmt.expression;
      if (isAstNode(expr) && getStringLiteralValue(expr) === "use strict") {
        return false;
      }
    }
    return true;
  });
  if (statements.length !== 1) return;
  const only = statements[0]!;
  if (only.type !== "ReturnStatement" || !isAstNode(only.argument)) return;
  return only.argument.type === "ArrayExpression" ? only.argument : undefined;
}

function extractTurbopackFactoryTableFromArrayNode(
  arrayNode: JsAstNode,
  source: string,
  groups: TurbopackFactoryGroup[],
  options: { allowLeadingNestedTable: boolean },
  depth = 0,
): boolean {
  if (depth > 2 || !Array.isArray(arrayNode.elements)) return false;
  // Turbopack's `installCompressedModuleFactories` walks a flat array of one or
  // more consecutive module IDs followed by their shared factory function
  // (`[3042, 77420, (a, b) => ...]`). Actual spread elements (`...[...]` or
  // `...(() => { "use strict"; return [...]; })()`) always flatten at runtime;
  // an unspread leading nested array is only flattened when the installed
  // Next.js runtime (such as Next 16.4.1) explicitly checks `Array.isArray` in
  // `installCompressedModuleFactories`.
  let pendingIds: string[] = [];
  for (let elemIndex = 0; elemIndex < arrayNode.elements.length; elemIndex += 1) {
    const elem = arrayNode.elements[elemIndex] as JsAstNode | null;
    if (!elem) return false;
    if (elem.type === "SpreadElement") {
      if (pendingIds.length !== 0 || !isAstNode(elem.argument)) return false;
      const nestedArray = unwrapTurbopackArrayNode(elem.argument);
      if (
        !nestedArray ||
        !extractTurbopackFactoryTableFromArrayNode(nestedArray, source, groups, options, depth + 1)
      ) {
        return false;
      }
      continue;
    }
    if (options.allowLeadingNestedTable && elemIndex === 0 && pendingIds.length === 0) {
      const leadingNestedArray = unwrapTurbopackArrayNode(elem);
      if (leadingNestedArray) {
        if (
          !extractTurbopackFactoryTableFromArrayNode(
            leadingNestedArray,
            source,
            groups,
            options,
            depth + 1,
          )
        ) {
          return false;
        }
        continue;
      }
    }
    const numericId = getNumberLiteralValue(elem);
    if (numericId !== undefined && numericId >= 0) {
      pendingIds.push(`n:${numericId}`);
      continue;
    }
    const stringId = getStringLiteralValue(elem);
    if (stringId !== undefined) {
      pendingIds.push(`s:${stringId}`);
      continue;
    }
    if (pendingIds.length === 0) return false;
    groups.push({ ids: pendingIds, factory: source.slice(elem.start, elem.end).trim() });
    pendingIds = [];
  }
  return pendingIds.length === 0;
}

function extractTurbopackModulesFromSource(
  source: string,
  options: {
    requireTable: boolean;
    resolveFromDir?: string;
    allowLeadingNestedTable?: boolean;
  } = { requireTable: true },
): TurbopackExtractedChunk | null {
  const program = parseJsProgram(source, options.resolveFromDir);
  if (!program || !Array.isArray(program.body)) return null;
  let liveGroups: TurbopackFactoryGroup[] | null = null;
  let invalid = false;
  const tableOptions = { allowLeadingNestedTable: Boolean(options.allowLeadingNestedTable) };

  const topLevelTables = new Set<JsAstNode>();
  for (const stmt of program.body as JsAstNode[]) {
    if (stmt.type !== "ExpressionStatement" || !isAstNode(stmt.expression)) continue;
    const exprs =
      stmt.expression.type === "SequenceExpression" && Array.isArray(stmt.expression.expressions)
        ? (stmt.expression.expressions as JsAstNode[])
        : [stmt.expression];
    for (const expr of exprs) {
      if (
        expr.type === "AssignmentExpression" &&
        expr.operator === "=" &&
        isAstNode(expr.left) &&
        isModuleExportsMember(expr.left) &&
        isAstNode(expr.right)
      ) {
        const arrayNode = unwrapTurbopackArrayNode(expr.right);
        if (arrayNode) {
          const nextGroups: TurbopackFactoryGroup[] = [];
          if (
            !extractTurbopackFactoryTableFromArrayNode(arrayNode, source, nextGroups, tableOptions)
          ) {
            return null;
          }
          // CommonJS `require()` returns only the final unconditional
          // `module.exports` value, so replace any earlier overwritten table.
          liveGroups = nextGroups;
          topLevelTables.add(expr);
        } else if (options.requireTable) {
          liveGroups = null;
          topLevelTables.add(expr);
        }
      }
    }
  }

  if (options.requireTable) {
    // Reject chunks that also assign `module.exports` inside nested blocks or
    // control flow outside top-level unconditional assignments.
    walkJsAst(program, undefined, (node) => {
      if (invalid || topLevelTables.has(node)) return false;
      if (
        node.type === "AssignmentExpression" &&
        isAstNode(node.left) &&
        isModuleExportsMember(node.left)
      ) {
        invalid = true;
        return false;
      }
      return;
    });
    if (invalid || liveGroups === null) return null;
  }

  return { groups: liveGroups ?? [] };
}

function buildResolvedTurbopackModuleMap(
  allGroups: readonly TurbopackFactoryGroup[],
): Map<string, string | null> {
  // Turbopack's `installCompressedModuleFactories()` installs an entire ID
  // group using the first already-registered member's factory. When overlapping
  // ID groups across chunks carry conflicting factories, every module ID in the
  // connected component of overlapping groups is ambiguous (`null`) so no
  // sibling ID can silently resolve to the wrong factory.
  const idToGroupIndices = new Map<string, number[]>();
  for (let groupIdx = 0; groupIdx < allGroups.length; groupIdx += 1) {
    for (const id of allGroups[groupIdx]!.ids) {
      const list = idToGroupIndices.get(id);
      if (list) list.push(groupIdx);
      else idToGroupIndices.set(id, [groupIdx]);
    }
  }

  const resolved = new Map<string, string | null>();
  const visitedGroups = new Uint8Array(allGroups.length);
  for (let startGroup = 0; startGroup < allGroups.length; startGroup += 1) {
    if (visitedGroups[startGroup]) continue;
    const queue = [startGroup];
    visitedGroups[startGroup] = 1;
    const componentIds = new Set<string>();
    let sharedFactory: string | undefined;
    let conflicted = false;

    while (queue.length > 0) {
      const group = allGroups[queue.pop()!]!;
      if (sharedFactory === undefined) {
        sharedFactory = group.factory;
      } else if (sharedFactory !== group.factory) {
        conflicted = true;
      }
      for (const id of group.ids) {
        if (componentIds.has(id)) continue;
        componentIds.add(id);
        for (const neighborIdx of idToGroupIndices.get(id) ?? []) {
          if (!visitedGroups[neighborIdx]) {
            visitedGroups[neighborIdx] = 1;
            queue.push(neighborIdx);
          }
        }
      }
    }

    const finalFactory = conflicted ? null : (sharedFactory ?? null);
    for (const id of componentIds) {
      resolved.set(id, finalFactory);
    }
  }
  return resolved;
}

function createTurbopackModuleResolver(
  inlineSources: readonly string[],
  chunkPaths: readonly string[] = [],
  chunkCache?: TurbopackChunkModuleCache,
  resolveFromDir?: string,
  allowLeadingNestedTable = false,
): TurbopackModuleResolver {
  const inlineGroups: TurbopackFactoryGroup[] = [];
  let hasUnparseableSource = false;
  for (const source of inlineSources) {
    const extracted = extractTurbopackModulesFromSource(source, {
      requireTable: false,
      resolveFromDir,
      allowLeadingNestedTable,
    });
    if (!extracted) {
      hasUnparseableSource = true;
    } else {
      inlineGroups.push(...extracted.groups);
    }
  }

  let resolvedMap: Map<string, string | null> | undefined;

  const resolver: TurbopackModuleResolver = (moduleId: string): string | null | undefined => {
    if (resolvedMap === undefined) {
      const allGroups: TurbopackFactoryGroup[] = [...inlineGroups];
      for (const chunkPath of chunkPaths) {
        const cacheKey = allowLeadingNestedTable ? `nested:${chunkPath}` : chunkPath;
        let extracted = chunkCache?.get(cacheKey);
        if (extracted === undefined) {
          try {
            extracted = extractTurbopackModulesFromSource(readFileSync(chunkPath, "utf8"), {
              requireTable: true,
              resolveFromDir,
              allowLeadingNestedTable,
            });
          } catch {
            // Unreadable or unparseable sibling chunks could register a
            // conflicting factory; fail closed by treating lookups as ambiguous.
            extracted = null;
          }
          chunkCache?.set(cacheKey, extracted);
        }
        if (extracted) {
          allGroups.push(...extracted.groups);
        } else {
          hasUnparseableSource = true;
        }
      }
      resolvedMap = hasUnparseableSource ? new Map() : buildResolvedTurbopackModuleMap(allGroups);
    }
    if (hasUnparseableSource) return null;
    return resolvedMap.get(moduleId);
  };
  if (chunkCache) {
    let runtimeVerifyCache = RUNTIME_EXPORT_VERIFY_CACHE.get(chunkCache);
    if (!runtimeVerifyCache) {
      runtimeVerifyCache = new Map();
      RUNTIME_EXPORT_VERIFY_CACHE.set(chunkCache, runtimeVerifyCache);
    }
    RESOLVER_RUNTIME_VERIFY_CACHE.set(resolver, runtimeVerifyCache);
  }
  return resolver;
}

function resolveUniqueTopLevelImportSource(
  scopeSource: string,
  ns: string,
  moduleParam: string | undefined,
): string | undefined {
  type ImportScopeFrame = {
    isFunction: boolean;
    shadowed: boolean;
    declKind?: "let" | "const" | "var";
    exprDepth: number;
    pendingCondition: boolean;
    conditionalStmt: boolean;
  };
  const nsWord = new RegExp(`(?:(?<![\\w$.])|\\.\\.\\.)${escapeRegExpLiteral(ns)}(?![\\w$])`, "u");
  const frames: ImportScopeFrame[] = [
    {
      isFunction: true,
      shadowed: false,
      exprDepth: 0,
      pendingCondition: false,
      conditionalStmt: false,
    },
  ];
  const isShadowed = () => frames.slice(1).some((frame) => frame.shadowed);
  let resolvedSource: string | undefined;
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let prevWord = "";
  let prevNonWsChar = "";
  let regexAllowed = true;
  let index = 0;

  while (index < scopeSource.length) {
    const ch = scopeSource[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (scopeSource[index + 1] === "/" || scopeSource[index + 1] === "*")) {
      index = skipWhitespaceAndComments(scopeSource, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(scopeSource, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(scopeSource, index);
      if (end === -1) return;
      const literal = scopeSource.slice(index, end);
      if (!isShadowed() && literal.includes("${") && nsWord.test(literal)) {
        // Template interpolations referencing `ns` without assignment (e.g. `${ns.FOO}`)
        // are read-only; reject only if the interpolation contains a write to `ns`.
        if (hasWriteToIdentifier(literal, ns)) return;
      }
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "`";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(scopeSource, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        prevWord = "";
        prevNonWsChar = "/";
        regexAllowed = false;
        continue;
      }
    }
    const top = frames.at(-1)!;
    if (ch === "{") {
      const beforeBrace = scopeSource.slice(Math.max(0, index - 240), index);
      const arrowParamsMatch = /(?:^|[^\w$])(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*$/u.exec(
        beforeBrace,
      );
      const fnParamsMatch = /(?:^|[^\w$])function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^()]*)\)\s*$/u.exec(
        beforeBrace,
      );
      const paramText = arrowParamsMatch
        ? (arrowParamsMatch[1] ?? arrowParamsMatch[2] ?? "")
        : fnParamsMatch
          ? (fnParamsMatch[1] ?? "")
          : undefined;
      const isFunction = paramText !== undefined;
      const paramShadowsNs =
        paramText !== undefined &&
        new RegExp(`(?:^|[^\\w$.])${escapeRegExpLiteral(ns)}(?![\\w$])`, "u").test(paramText);
      top.conditionalStmt = false;
      top.pendingCondition = false;
      frames.push({
        isFunction,
        shadowed: paramShadowsNs,
        exprDepth: 0,
        pendingCondition: false,
        conditionalStmt: false,
      });
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "{";
      regexAllowed = true;
      continue;
    }
    if (ch === "}") {
      if (frames.length <= 1) return;
      frames.pop();
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "}";
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      top.exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (top.exprDepth > 0) top.exprDepth -= 1;
      let closedCondition = false;
      if (ch === ")" && top.exprDepth === 0 && top.pendingCondition) {
        top.pendingCondition = false;
        top.conditionalStmt = true;
        closedCondition = true;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = closedCondition;
      continue;
    }
    if (ch === ";") {
      if (top.exprDepth === 0) {
        top.declKind = undefined;
        top.conditionalStmt = false;
        top.pendingCondition = false;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ";";
      regexAllowed = true;
      continue;
    }
    if (ch === ",") {
      index += 1;
      prevTokenKind = "comma";
      prevWord = "";
      prevNonWsChar = ",";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      if (scopeSource[index + 1] === "." && scopeSource[index + 2] === ".") {
        index += 3;
        prevTokenKind = "other";
        prevWord = "";
        prevNonWsChar = ".";
        regexAllowed = true;
        continue;
      }
      index += 1;
      prevTokenKind = "dot";
      prevWord = "";
      prevNonWsChar = ".";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < scopeSource.length && /[\w$]/u.test(scopeSource[index] ?? "")) index += 1;
      const word = scopeSource.slice(wordStart, index);
      if (prevTokenKind !== "dot") {
        if (top.exprDepth === 0 && (word === "let" || word === "const" || word === "var")) {
          top.declKind = word;
          prevTokenKind = "decl";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (top.exprDepth === 0 && (CONTROL_FLOW_KEYWORDS.has(word) || word === "for")) {
          top.pendingCondition = true;
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (top.exprDepth === 0 && (word === "else" || word === "do")) {
          top.conditionalStmt = true;
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = true;
          continue;
        }
        if (
          frames.length === 1 &&
          top.exprDepth === 0 &&
          word === "import" &&
          moduleParam === undefined
        ) {
          const afterImport = skipWhitespaceAndComments(scopeSource, index);
          const starMatch =
            /^\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/u.exec(
              scopeSource.slice(afterImport),
            );
          if (starMatch?.[1] === ns) {
            if (resolvedSource !== undefined) return;
            const spec = parseJsStringLiteral(starMatch[2]!);
            if (!spec) return;
            resolvedSource = spec;
          }
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (word === ns) {
          const afterWord = skipWhitespaceAndComments(scopeSource, index);
          const isDeclarator =
            top.exprDepth === 0 &&
            (prevTokenKind === "decl" || (prevTokenKind === "comma" && top.declKind !== undefined));
          if (frames.length === 1) {
            if (prevWord === "function" || prevWord === "class") return;
            if (isDeclarator) {
              if (resolvedSource !== undefined || top.conditionalStmt) return;
              if (
                scopeSource[afterWord] !== "=" ||
                scopeSource[afterWord + 1] === "=" ||
                scopeSource[afterWord + 1] === ">"
              ) {
                return;
              }
              const rhsStart = skipWhitespaceAndComments(scopeSource, afterWord + 1);
              const expectedPrefix = moduleParam
                ? new RegExp(`^${escapeRegExpLiteral(moduleParam)}\\s*\\.\\s*[ir]\\s*\\(`, "u")
                : /^require\s*\(/u;
              const callMatch = expectedPrefix.exec(scopeSource.slice(rhsStart));
              if (!callMatch) return;
              const callParen = rhsStart + callMatch[0].length - 1;
              const callEnd = scanBalancedEnd(scopeSource, callParen);
              if (callEnd === -1 || !endsInitializerAt(scopeSource, callEnd)) return;
              const arg = scopeSource.slice(callParen + 1, callEnd - 1).trim();
              if (moduleParam !== undefined) {
                const normalizedId = normalizeTurbopackModuleId(arg);
                if (!normalizedId) return;
                resolvedSource = normalizedId;
              } else {
                const spec = parseJsStringLiteral(arg);
                if (!spec) return;
                resolvedSource = spec;
              }
              index = callEnd;
            } else {
              const isObjectKey =
                (prevNonWsChar === "{" || prevNonWsChar === ",") && scopeSource[afterWord] === ":";
              if (!isObjectKey && isAssignmentOperatorAt(scopeSource, afterWord)) {
                return;
              }
            }
          } else if (isDeclarator) {
            // Inside a nested scope: a `let`/`const` declaration shadows `ns` in
            // this block; a `var` declaration shadows `ns` in the nearest enclosing
            // function (or fails if that enclosing function is the module scope!).
            if (top.declKind === "let" || top.declKind === "const") {
              top.shadowed = true;
            } else if (top.declKind === "var") {
              let fnIdx = frames.length - 1;
              while (fnIdx > 0 && !frames[fnIdx]!.isFunction) fnIdx -= 1;
              if (fnIdx === 0) return;
              frames[fnIdx]!.shadowed = true;
            }
          } else if (!isShadowed()) {
            const isObjectKey =
              (prevNonWsChar === "{" || prevNonWsChar === ",") && scopeSource[afterWord] === ":";
            if (!isObjectKey && isAssignmentOperatorAt(scopeSource, afterWord)) {
              return;
            }
          }
        }
      }
      prevTokenKind = "other";
      prevWord = word;
      prevNonWsChar = word.at(-1) ?? "";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < scopeSource.length && /[\w.]/u.test(scopeSource[index] ?? "")) index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "0";
      regexAllowed = false;
      continue;
    }
    if (
      (ch === "+" && scopeSource[index + 1] === "+") ||
      (ch === "-" && scopeSource[index + 1] === "-")
    ) {
      index += 2;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    prevWord = "";
    prevNonWsChar = ch ?? "";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  return resolvedSource;
}

function isImportedDirectCreateAppPageEntrypoint(scopeSource: string): boolean {
  let hasVerifiedImport = false;
  let exprDepth = 0;
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let declKind: "let" | "const" | "var" | undefined;
  let prevWord = "";
  let prevNonWsChar = "";
  let regexAllowed = true;
  let index = 0;

  while (index < scopeSource.length) {
    const ch = scopeSource[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (scopeSource[index + 1] === "/" || scopeSource[index + 1] === "*")) {
      index = skipWhitespaceAndComments(scopeSource, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "`";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(scopeSource, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        prevWord = "";
        prevNonWsChar = "/";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      const end = scanBalancedEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "}";
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (exprDepth > 0) exprDepth -= 1;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === ";") {
      if (exprDepth === 0) declKind = undefined;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ";";
      regexAllowed = true;
      continue;
    }
    if (ch === ",") {
      index += 1;
      prevTokenKind = "comma";
      prevWord = "";
      prevNonWsChar = ",";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      index += 1;
      prevTokenKind = "dot";
      prevWord = "";
      prevNonWsChar = ".";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < scopeSource.length && /[\w$]/u.test(scopeSource[index] ?? "")) index += 1;
      const word = scopeSource.slice(wordStart, index);
      if (prevTokenKind !== "dot") {
        if (exprDepth === 0 && (word === "let" || word === "const" || word === "var")) {
          declKind = word;
          prevTokenKind = "decl";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (exprDepth === 0 && word === "import") {
          const afterImport = skipWhitespaceAndComments(scopeSource, index);
          if (scopeSource[afterImport] === "{") {
            const braceEnd = scanBalancedEnd(scopeSource, afterImport);
            if (braceEnd === -1) return false;
            const afterBrace = skipWhitespaceAndComments(scopeSource, braceEnd);
            const fromMatch = /^from\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/u.exec(
              scopeSource.slice(afterBrace),
            );
            const fromSpecifier = fromMatch ? parseJsStringLiteral(fromMatch[1]!) : undefined;
            const specifiers = scopeSource.slice(afterImport + 1, braceEnd - 1).split(",");
            for (const rawSpec of specifiers) {
              const spec = rawSpec.trim();
              if (spec === "createAppPageEntrypoint") {
                if (
                  hasVerifiedImport ||
                  !fromSpecifier ||
                  !NEXT_APP_PAGE_RUNTIME_SPECIFIER.test(fromSpecifier)
                ) {
                  return false;
                }
                hasVerifiedImport = true;
              } else if (/\bas\s+createAppPageEntrypoint$/u.test(spec)) {
                return false;
              }
            }
            index = fromMatch ? afterBrace + fromMatch[0].length : braceEnd;
            prevTokenKind = "other";
            prevWord = "";
            prevNonWsChar = "}";
            regexAllowed = false;
            continue;
          }
        }
        if (word === "createAppPageEntrypoint") {
          const isLocalDecl =
            prevWord === "function" ||
            prevWord === "class" ||
            (exprDepth === 0 &&
              (prevTokenKind === "decl" || (prevTokenKind === "comma" && declKind !== undefined)));
          if (isLocalDecl) return false;
          const afterWord = skipWhitespaceAndComments(scopeSource, index);
          const isObjectKey =
            (prevNonWsChar === "{" || prevNonWsChar === ",") && scopeSource[afterWord] === ":";
          if (!isObjectKey && isAssignmentOperatorAt(scopeSource, afterWord)) return false;
        }
      }
      prevTokenKind = "other";
      prevWord = word;
      prevNonWsChar = word.at(-1) ?? "";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (
      (ch === "+" && scopeSource[index + 1] === "+") ||
      (ch === "-" && scopeSource[index + 1] === "-")
    ) {
      index += 2;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    prevWord = "";
    prevNonWsChar = ch ?? "";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  return hasVerifiedImport;
}

function parseTurbopackFactory(factorySource: string): { param: string; body: string } | undefined {
  let trimmed = factorySource.trim();
  // Unminified Turbopack wraps factories in outer parens: `((__turbopack_context__) => { ... })`.
  while (trimmed.startsWith("(") && scanBalancedEnd(trimmed, 0) === trimmed.length) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  const arrowMatch =
    /^(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*\{/u.exec(
      trimmed,
    );
  const fnMatch =
    /^function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)\s*\{/u.exec(
      trimmed,
    );
  const match = arrowMatch ?? fnMatch;
  const param = arrowMatch ? (arrowMatch[1] ?? arrowMatch[2]) : fnMatch?.[1];
  if (!match || !param) return;
  const openBrace = match[0].length - 1;
  const closeEnd = scanBalancedEnd(trimmed, openBrace);
  if (closeEnd !== trimmed.length) return;
  return { param, body: trimmed.slice(openBrace + 1, closeEnd - 1) };
}

function stripLeadingCommentsAndUseStrict(source: string): string {
  let index = skipWhitespaceAndComments(source, 0);
  const strictMatch = /^["']use strict["']\s*;?/u.exec(source.slice(index));
  if (strictMatch) {
    index = skipWhitespaceAndComments(source, index + strictMatch[0].length);
  }
  return source.slice(index).trim();
}

function unwrapTurbopackCompileTimeBranches(source: string): string {
  let body = stripLeadingCommentsAndUseStrict(source);
  for (let steps = 0; steps < 16; steps += 1) {
    if (body.startsWith("{") && scanBalancedEnd(body, 0) === body.length) {
      body = stripLeadingCommentsAndUseStrict(body.slice(1, -1));
      continue;
    }
    // Unminified Turbopack leaves compile-time constant branches in place:
    // `if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable\n; else { ... }`
    const falsyMatch =
      /^if\s*\(\s*"TURBOPACK compile-time falsy"\s*,\s*0\s*\)\s*(?:\/\/[^\n\r]*[\n\r]+\s*)?;\s*else\s*/u.exec(
        body,
      );
    if (falsyMatch) {
      const rest = body.slice(falsyMatch[0].length).trim();
      if (rest.startsWith("{") && scanBalancedEnd(rest, 0) === rest.length) {
        body = stripLeadingCommentsAndUseStrict(rest.slice(1, -1));
        continue;
      }
      body = stripLeadingCommentsAndUseStrict(rest);
      continue;
    }
    // `if ("TURBOPACK compile-time truthy", 1) { ... } else //TURBOPACK unreachable\n;`
    const truthyMatch = /^if\s*\(\s*"TURBOPACK compile-time truthy"\s*,\s*1\s*\)\s*\{/u.exec(body);
    if (truthyMatch) {
      const openBrace = truthyMatch[0].length - 1;
      const closeEnd = scanBalancedEnd(body, openBrace);
      if (closeEnd !== -1) {
        const trailing = body.slice(closeEnd).trim();
        if (trailing === "" || /^else\s*(?:\/\/[^\n\r]*[\n\r]+\s*)?;$/u.test(trailing)) {
          body = stripLeadingCommentsAndUseStrict(body.slice(openBrace + 1, closeEnd - 1));
          continue;
        }
      }
    }
    break;
  }
  return body;
}

function isNextAppPageExternalModule(
  moduleId: string,
  resolveModule: TurbopackModuleResolver,
  depth = 0,
): boolean {
  if (depth > 4) return false;
  const factory = resolveModule(moduleId);
  if (typeof factory !== "string") return false;
  const parsed = parseTurbopackFactory(factory);
  if (!parsed) return false;
  const body = unwrapTurbopackCompileTimeBranches(parsed.body);
  const p = escapeRegExpLiteral(parsed.param);

  // Direct external wrapper — minified single statement or unminified two-statement form:
  // `b.exports = a.x("next/dist/...", () => require("next/dist/..."))`
  // `var mod = __turbopack_context__.x("next/dist/...", () => require("next/dist/...")); module.exports = mod;`
  const xCall = `${p}\\.x\\(\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*,\\s*(?:\\(\\s*\\)\\s*=>\\s*require\\(\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)|function\\s*\\(\\s*\\)\\s*\\{\\s*return\\s+require\\(\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)\\s*;?\\s*\\})\\s*\\)`;
  const externalDirect = new RegExp(
    `^[A-Za-z_$][\\w$]*\\.exports\\s*=\\s*${xCall}\\s*;?$`,
    "u",
  ).exec(body);
  const externalViaVar = new RegExp(
    `^(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${xCall}\\s*;\\s*[A-Za-z_$][\\w$]*\\.exports\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*;?$`,
    "u",
  ).exec(body);
  if (externalDirect) {
    const specA = parseJsStringLiteral(externalDirect[1]!);
    const specB = parseJsStringLiteral(externalDirect[2] ?? externalDirect[3] ?? "");
    return specA !== undefined && specA === specB && NEXT_APP_PAGE_EXTERNAL_SPECIFIER.test(specA);
  }
  if (externalViaVar && externalViaVar[1] === externalViaVar[5]) {
    const specA = parseJsStringLiteral(externalViaVar[2]!);
    const specB = parseJsStringLiteral(externalViaVar[3] ?? externalViaVar[4] ?? "");
    return specA !== undefined && specA === specB && NEXT_APP_PAGE_EXTERNAL_SPECIFIER.test(specA);
  }

  // Re-export hop: `b.exports = a.r(18622)` or `a.n(a.i(18622))`
  const reexportMatch = new RegExp(
    `^(?:[A-Za-z_$][\\w$]*\\.exports\\s*=\\s*${p}\\.[ir]\\(\\s*(\\d+(?:\\.\\d+)?(?:[eE]\\+?\\d+)?|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)|${p}\\.n\\(\\s*${p}\\.[ir]\\(\\s*(\\d+(?:\\.\\d+)?(?:[eE]\\+?\\d+)?|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)\\s*\\))\\s*;?$`,
    "u",
  ).exec(body);
  const nextRawId = reexportMatch?.[1] ?? reexportMatch?.[2];
  const nextId = nextRawId ? normalizeTurbopackModuleId(nextRawId) : undefined;
  if (!nextId) return false;
  return isNextAppPageExternalModule(nextId, resolveModule, depth + 1);
}

function extractTurbopackExportedFunction(
  body: string,
  moduleParam: string,
  runtimeModuleId: string,
  exportName: string,
): string | undefined {
  const sCallPattern = new RegExp(
    `(?:^|[^\\w$.])${escapeRegExpLiteral(moduleParam)}\\s*\\.\\s*s\\s*\\(`,
    "gu",
  );
  let foundExpr: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = sCallPattern.exec(body)) !== null) {
    const parenIndex = match.index + match[0].length - 1;
    const callEnd = scanBalancedEnd(body, parenIndex);
    if (callEnd === -1) return;
    const arrStart = skipWhitespaceAndComments(body, parenIndex + 1);
    if (body[arrStart] !== "[") continue;
    const arrEnd = scanBalancedEnd(body, arrStart);
    if (arrEnd === -1 || arrEnd > callEnd - 1) continue;
    const afterArray = skipWhitespaceAndComments(body, arrEnd);
    const targetArg = parseTurbopackTargetModuleArg(body, afterArray, callEnd);
    if (targetArg.status === "invalid") return;
    if (targetArg.status === "target" && targetArg.moduleId !== runtimeModuleId) continue;
    const elements = splitTopLevelArrayElements(body.slice(arrStart, arrEnd), 0);
    if (!elements) continue;
    const bindings = parseTurbopackEsmExportBindings(elements);
    if (!bindings) continue;
    for (const binding of bindings) {
      if (binding.name !== exportName) continue;
      if (foundExpr !== undefined) return;
      foundExpr = binding.kind === "value" ? binding.expr : binding.getterExpr;
    }
  }
  if (!foundExpr) return;
  if (/^function\b/u.test(foundExpr)) return foundExpr;
  // Unminified value (`["f", 0, createAppPageEntrypoint]`) or getter export
  // (`["f", () => createAppPageEntrypoint]`): look up the top-level function declaration.
  const targetIdent = /^[A-Za-z_$][\w$]*$/u.test(foundExpr)
    ? foundExpr
    : unwrapExportGetter(foundExpr);
  if (targetIdent && /^[A-Za-z_$][\w$]*$/u.test(targetIdent)) {
    const fnDecl = new RegExp(
      `(?:^|[;}\\n\\r])\\s*(?:export\\s+)?function\\s+${escapeRegExpLiteral(targetIdent)}\\s*\\(`,
      "gu",
    );
    const fnMatch = fnDecl.exec(body);
    if (!fnMatch || fnDecl.exec(body)) return;
    const fnStart = body.indexOf("function", fnMatch.index);
    const paramsOpen = body.indexOf("(", fnStart);
    const paramsClose = scanBalancedEnd(body, paramsOpen);
    if (paramsClose === -1) return;
    const bodyOpen = skipWhitespaceAndComments(body, paramsClose);
    if (body[bodyOpen] !== "{") return;
    const bodyClose = scanBalancedEnd(body, bodyOpen);
    if (bodyClose === -1) return;
    return body.slice(fnStart, bodyClose);
  }
  return;
}

const AST_METADATA_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "extra",
  "comments",
  "tokens",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

function collectPatternBindingNames(
  pattern: JsAstNode | undefined,
  names: Set<string>,
  skipOffset = -1,
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier": {
      if (typeof pattern.name === "string" && pattern.start !== skipOffset) {
        names.add(pattern.name);
      }
      return;
    }
    case "RestElement":
    case "SpreadElement": {
      if (isAstNode(pattern.argument)) {
        collectPatternBindingNames(pattern.argument, names, skipOffset);
      }
      return;
    }
    case "AssignmentPattern": {
      if (isAstNode(pattern.left)) {
        collectPatternBindingNames(pattern.left, names, skipOffset);
      }
      return;
    }
    case "ArrayPattern": {
      if (Array.isArray(pattern.elements)) {
        for (const elem of pattern.elements) {
          if (isAstNode(elem)) collectPatternBindingNames(elem, names, skipOffset);
        }
      }
      return;
    }
    case "ObjectPattern": {
      if (Array.isArray(pattern.properties)) {
        for (const prop of pattern.properties) {
          if (!isAstNode(prop)) continue;
          if (prop.type === "RestElement" && isAstNode(prop.argument)) {
            collectPatternBindingNames(prop.argument, names, skipOffset);
          } else if (prop.type === "ObjectProperty" && isAstNode(prop.value)) {
            collectPatternBindingNames(prop.value, names, skipOffset);
          }
        }
      }
      return;
    }
    default:
      return;
  }
}

function collectLexicalStatementBindings(statements: readonly unknown[], names: Set<string>): void {
  for (const stmt of statements) {
    if (!isAstNode(stmt)) continue;
    if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
      if (Array.isArray(stmt.declarations)) {
        for (const decl of stmt.declarations) {
          if (isAstNode(decl) && isAstNode(decl.id)) {
            collectPatternBindingNames(decl.id, names);
          }
        }
      }
    } else if (
      (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") &&
      isAstNode(stmt.id) &&
      stmt.id.type === "Identifier" &&
      typeof stmt.id.name === "string"
    ) {
      names.add(stmt.id.name);
    }
  }
}

function collectHoistedVarBindings(node: JsAstNode, names: Set<string>): void {
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod" ||
    node.type === "StaticBlock"
  ) {
    return;
  }
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    if (Array.isArray(node.declarations)) {
      for (const decl of node.declarations) {
        if (isAstNode(decl) && isAstNode(decl.id)) {
          collectPatternBindingNames(decl.id, names);
        }
      }
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (AST_METADATA_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) collectHoistedVarBindings(item, names);
      }
    } else if (isAstNode(value)) {
      collectHoistedVarBindings(value, names);
    }
  }
}

function targetWritesToIdent(node: JsAstNode, ident: string): boolean {
  switch (node.type) {
    case "Identifier":
      return node.name === ident;
    case "MemberExpression":
    case "OptionalMemberExpression":
      return isAstNode(node.object) && targetWritesToIdent(node.object, ident);
    case "RestElement":
    case "SpreadElement":
      return isAstNode(node.argument) && targetWritesToIdent(node.argument, ident);
    case "AssignmentPattern":
      return isAstNode(node.left) && targetWritesToIdent(node.left, ident);
    case "ArrayPattern":
      return (
        Array.isArray(node.elements) &&
        node.elements.some((elem) => isAstNode(elem) && targetWritesToIdent(elem, ident))
      );
    case "ObjectPattern":
      return (
        Array.isArray(node.properties) &&
        node.properties.some((prop) => {
          if (!isAstNode(prop)) return false;
          if (prop.type === "RestElement") {
            return isAstNode(prop.argument) && targetWritesToIdent(prop.argument, ident);
          }
          if (prop.type === "ObjectProperty") {
            return isAstNode(prop.value) && targetWritesToIdent(prop.value, ident);
          }
          return false;
        })
      );
    default:
      return false;
  }
}

function hasWriteToIdentifier(source: string, ident: string, skipOffset = -1): boolean {
  const program = parseJsProgram(source);
  if (!program) return true;

  let foundWrite = false;

  const visitChildren = (node: JsAstNode, depth: number, skipKey?: string): void => {
    for (const [key, value] of Object.entries(node)) {
      if (foundWrite) return;
      if (AST_METADATA_KEYS.has(key) || key === skipKey) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (foundWrite) return;
          if (isAstNode(item)) visit(item, depth);
        }
      } else if (isAstNode(value)) {
        visit(value, depth);
      }
    }
  };

  // Visit executable expressions embedded inside binding patterns (default
  // initializers and computed property keys) without treating ordinary binding
  // identifiers as assignments.
  const visitPatternExpressions = (pattern: JsAstNode, depth: number): void => {
    if (foundWrite) return;
    switch (pattern.type) {
      case "Identifier":
        return;
      case "RestElement":
      case "SpreadElement":
        if (isAstNode(pattern.argument)) visitPatternExpressions(pattern.argument, depth);
        return;
      case "AssignmentPattern":
        if (isAstNode(pattern.right)) visit(pattern.right, depth);
        if (!foundWrite && isAstNode(pattern.left)) visitPatternExpressions(pattern.left, depth);
        return;
      case "ArrayPattern":
        if (Array.isArray(pattern.elements)) {
          for (const elem of pattern.elements) {
            if (foundWrite) return;
            if (isAstNode(elem)) visitPatternExpressions(elem, depth);
          }
        }
        return;
      case "ObjectPattern":
        if (Array.isArray(pattern.properties)) {
          for (const prop of pattern.properties) {
            if (foundWrite) return;
            if (!isAstNode(prop)) continue;
            if (prop.type === "RestElement" && isAstNode(prop.argument)) {
              visitPatternExpressions(prop.argument, depth);
            } else if (prop.type === "ObjectProperty") {
              if (prop.computed && isAstNode(prop.key)) visit(prop.key, depth);
              if (!foundWrite && isAstNode(prop.value)) visitPatternExpressions(prop.value, depth);
            }
          }
        }
        return;
      default:
        visit(pattern, depth);
    }
  };

  const visit = (node: JsAstNode, depth: number): void => {
    if (foundWrite) return;

    // Nested functions create both parameter and hoisted `var`/function scopes.
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      if (
        node.type === "FunctionDeclaration" &&
        depth === 0 &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === ident &&
        node.id.start !== skipOffset
      ) {
        foundWrite = true;
        return;
      }
      if (
        (node.type === "ObjectMethod" || node.type === "ClassMethod") &&
        node.computed &&
        isAstNode(node.key)
      ) {
        visit(node.key, depth);
        if (foundWrite) return;
      }
      if (
        node.type === "FunctionExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === ident
      ) {
        return;
      }
      const paramNames = new Set<string>();
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (isAstNode(param)) collectPatternBindingNames(param, paramNames);
        }
      }
      if (paramNames.has(ident)) return;
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (isAstNode(param)) visitPatternExpressions(param, depth + 1);
        }
      }
      if (foundWrite || !isAstNode(node.body)) return;
      const hoistedNames = new Set<string>();
      collectHoistedVarBindings(node.body, hoistedNames);
      if (hoistedNames.has(ident)) return;
      visit(node.body, depth + 1);
      return;
    }

    if (node.type === "BlockStatement" || node.type === "StaticBlock") {
      if (Array.isArray(node.body)) {
        const blockNames = new Set<string>();
        collectLexicalStatementBindings(node.body, blockNames);
        if (blockNames.has(ident)) return;
      }
      visitChildren(node, depth + 1);
      return;
    }

    if (node.type === "SwitchStatement") {
      if (isAstNode(node.discriminant)) visit(node.discriminant, depth);
      if (foundWrite) return;
      if (Array.isArray(node.cases)) {
        const switchNames = new Set<string>();
        for (const c of node.cases) {
          if (isAstNode(c) && Array.isArray(c.consequent)) {
            collectLexicalStatementBindings(c.consequent, switchNames);
          }
        }
        if (switchNames.has(ident)) return;
        for (const c of node.cases) {
          if (isAstNode(c)) visit(c, depth + 1);
        }
      }
      return;
    }

    if (node.type === "ForStatement") {
      if (
        isAstNode(node.init) &&
        node.init.type === "VariableDeclaration" &&
        node.init.kind !== "var"
      ) {
        const loopNames = new Set<string>();
        collectLexicalStatementBindings([node.init], loopNames);
        if (loopNames.has(ident)) return;
      }
      visitChildren(node, depth + 1);
      return;
    }

    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      if (isAstNode(node.left)) {
        if (node.left.type === "VariableDeclaration") {
          if (node.left.kind !== "var") {
            const loopNames = new Set<string>();
            collectLexicalStatementBindings([node.left], loopNames);
            if (loopNames.has(ident)) return;
          }
        } else if (targetWritesToIdent(node.left, ident)) {
          foundWrite = true;
          return;
        }
      }
      visitChildren(node, depth + 1);
      return;
    }

    if (node.type === "CatchClause") {
      if (isAstNode(node.param)) {
        const catchNames = new Set<string>();
        collectPatternBindingNames(node.param, catchNames);
        if (catchNames.has(ident)) return;
        visitPatternExpressions(node.param, depth + 1);
        if (foundWrite) return;
      }
      if (isAstNode(node.body)) visit(node.body, depth + 1);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (
        node.type === "ClassDeclaration" &&
        depth === 0 &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === ident &&
        node.id.start !== skipOffset
      ) {
        foundWrite = true;
        return;
      }
      if (isAstNode(node.superClass)) {
        visit(node.superClass, depth);
        if (foundWrite) return;
      }
      if (
        node.type === "ClassExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === ident
      ) {
        return;
      }
      if (isAstNode(node.body)) visit(node.body, depth + 1);
      return;
    }

    if (node.type === "VariableDeclaration") {
      if (Array.isArray(node.declarations)) {
        for (const decl of node.declarations) {
          if (!isAstNode(decl)) continue;
          if (isAstNode(decl.id)) {
            const declNames = new Set<string>();
            collectPatternBindingNames(decl.id, declNames, skipOffset);
            if (declNames.has(ident)) {
              foundWrite = true;
              return;
            }
            visitPatternExpressions(decl.id, depth);
            if (foundWrite) return;
          }
          if (isAstNode(decl.init)) visit(decl.init, depth);
          if (foundWrite) return;
        }
      }
      return;
    }

    if (node.type === "AssignmentExpression") {
      if (isAstNode(node.left) && targetWritesToIdent(node.left, ident)) {
        foundWrite = true;
        return;
      }
    } else if (node.type === "UpdateExpression") {
      if (isAstNode(node.argument) && targetWritesToIdent(node.argument, ident)) {
        foundWrite = true;
        return;
      }
    } else if (node.type === "UnaryExpression" && node.operator === "delete") {
      if (isAstNode(node.argument) && targetWritesToIdent(node.argument, ident)) {
        foundWrite = true;
        return;
      }
    }

    visitChildren(node, depth);
  };

  visit(program, 0);
  return foundWrite;
}

function findObjectPropertyNode(objNode: JsAstNode, keyName: string): JsAstNode | undefined {
  if (objNode.type !== "ObjectExpression" || !Array.isArray(objNode.properties)) return;
  for (const prop of objNode.properties) {
    if (!isAstNode(prop) || prop.type !== "ObjectProperty" || !isAstNode(prop.key)) continue;
    const matched = prop.computed
      ? getStringLiteralValue(prop.key) === keyName
      : (prop.key.type === "Identifier" && prop.key.name === keyName) ||
        getStringLiteralValue(prop.key) === keyName;
    if (matched) return prop;
  }
  return;
}

function isObjectOrReflectMutationCallee(callee: JsAstNode): boolean {
  if (callee.type !== "MemberExpression" || !isAstNode(callee.object)) return false;
  if (callee.object.type !== "Identifier") return false;
  return callee.object.name === "Object" || callee.object.name === "Reflect";
}

function isIdentifierReference(node: JsAstNode, parent: JsAstNode | undefined): boolean {
  if (node.type !== "Identifier") return false;
  if (!parent) return true;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    !parent.computed &&
    parent.property === node
  ) {
    return false;
  }
  if (
    parent.type === "ObjectProperty" &&
    !parent.computed &&
    parent.key === node &&
    !parent.shorthand
  ) {
    return false;
  }
  if (
    (parent.type === "ObjectMethod" ||
      parent.type === "ClassMethod" ||
      parent.type === "ClassProperty") &&
    !parent.computed &&
    parent.key === node
  ) {
    return false;
  }
  if (
    parent.type === "LabeledStatement" ||
    parent.type === "BreakStatement" ||
    parent.type === "ContinueStatement"
  ) {
    return false;
  }
  return true;
}

function unwrapIndirectCalleeIdent(callee: JsAstNode): string | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") return callee.name;
  if (
    callee.type === "SequenceExpression" &&
    Array.isArray(callee.expressions) &&
    callee.expressions.length === 2
  ) {
    const [first, second] = callee.expressions as [JsAstNode, JsAstNode];
    if (
      isAstNode(first) &&
      getNumberLiteralValue(first) === 0 &&
      isAstNode(second) &&
      second.type === "Identifier" &&
      typeof second.name === "string"
    ) {
      return second.name;
    }
  }
  return;
}

function isRouteModuleRenderCall(callee: JsAstNode, routeModVar: string): boolean {
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (!isAstNode(callee.object) || callee.object.type !== "Identifier") return false;
  if (callee.object.name !== routeModVar) return false;
  const propName = getMemberPropertyName(callee);
  return propName === "render" || propName === "prerender";
}

function collectLexicalScopeRefs(
  root: JsAstNode,
  targetName: string,
  skipNode: JsAstNode | undefined,
): Array<{ node: JsAstNode; ancestors: JsAstNode[] }> {
  const refs: Array<{ node: JsAstNode; ancestors: JsAstNode[] }> = [];
  const visit = (node: JsAstNode, ancestors: JsAstNode[], shadowed: boolean): void => {
    if (shadowed || node === skipNode) return;

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      if (
        (node.type === "ObjectMethod" || node.type === "ClassMethod") &&
        node.computed &&
        isAstNode(node.key)
      ) {
        visit(node.key, [...ancestors, node], false);
      }
      if (
        node.type === "FunctionExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === targetName
      ) {
        return;
      }
      const paramNames = new Set<string>();
      if (Array.isArray(node.params)) {
        for (const p of node.params) {
          if (isAstNode(p)) collectPatternBindingNames(p, paramNames);
        }
      }
      if (paramNames.has(targetName)) return;
      const nextAncestors = [...ancestors, node];
      if (Array.isArray(node.params)) {
        for (const p of node.params) {
          if (isAstNode(p)) visitPattern(p, nextAncestors);
        }
      }
      if (isAstNode(node.body)) {
        const hoisted = new Set<string>();
        collectHoistedVarBindings(node.body, hoisted);
        if (!hoisted.has(targetName)) {
          visit(node.body, nextAncestors, false);
        }
      }
      return;
    }

    if (node.type === "BlockStatement" || node.type === "StaticBlock") {
      if (node !== root && Array.isArray(node.body)) {
        const blockNames = new Set<string>();
        collectLexicalStatementBindings(node.body, blockNames);
        if (blockNames.has(targetName)) return;
      }
      walkChildren(node, [...ancestors, node]);
      return;
    }

    if (node.type === "SwitchStatement") {
      if (isAstNode(node.discriminant)) visit(node.discriminant, [...ancestors, node], false);
      if (Array.isArray(node.cases)) {
        const switchNames = new Set<string>();
        for (const c of node.cases) {
          if (isAstNode(c) && Array.isArray(c.consequent)) {
            collectLexicalStatementBindings(c.consequent, switchNames);
          }
        }
        if (switchNames.has(targetName)) return;
        const nextAncestors = [...ancestors, node];
        for (const c of node.cases) {
          if (isAstNode(c)) visit(c, nextAncestors, false);
        }
      }
      return;
    }

    if (node.type === "ForStatement") {
      if (
        isAstNode(node.init) &&
        node.init.type === "VariableDeclaration" &&
        node.init.kind !== "var"
      ) {
        const loopNames = new Set<string>();
        collectLexicalStatementBindings([node.init], loopNames);
        if (loopNames.has(targetName)) return;
      }
      walkChildren(node, [...ancestors, node]);
      return;
    }

    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      if (
        isAstNode(node.left) &&
        node.left.type === "VariableDeclaration" &&
        node.left.kind !== "var"
      ) {
        const loopNames = new Set<string>();
        collectLexicalStatementBindings([node.left], loopNames);
        if (loopNames.has(targetName)) return;
      }
      walkChildren(node, [...ancestors, node]);
      return;
    }

    if (node.type === "CatchClause") {
      if (isAstNode(node.param)) {
        const catchNames = new Set<string>();
        collectPatternBindingNames(node.param, catchNames);
        if (catchNames.has(targetName)) return;
        visitPattern(node.param, [...ancestors, node]);
      }
      if (isAstNode(node.body)) visit(node.body, [...ancestors, node], false);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (isAstNode(node.superClass)) visit(node.superClass, [...ancestors, node], false);
      if (
        node.type === "ClassExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        node.id.name === targetName
      ) {
        return;
      }
      if (isAstNode(node.body)) visit(node.body, [...ancestors, node], false);
      return;
    }

    if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
      const nextAncestors = [...ancestors, node];
      for (const decl of node.declarations) {
        if (!isAstNode(decl) || decl === skipNode) continue;
        if (isAstNode(decl.id)) visitPattern(decl.id, [...nextAncestors, decl]);
        if (isAstNode(decl.init)) visit(decl.init, [...nextAncestors, decl], false);
      }
      return;
    }

    const parent = ancestors.at(-1);
    if (isIdentifierReference(node, parent) && node.name === targetName) {
      refs.push({ node, ancestors });
      return;
    }

    walkChildren(node, [...ancestors, node]);
  };

  const visitPattern = (pattern: JsAstNode, ancestors: JsAstNode[]): void => {
    switch (pattern.type) {
      case "Identifier":
        return;
      case "RestElement":
      case "SpreadElement":
        if (isAstNode(pattern.argument)) visitPattern(pattern.argument, [...ancestors, pattern]);
        return;
      case "AssignmentPattern":
        if (isAstNode(pattern.right)) visit(pattern.right, [...ancestors, pattern], false);
        if (isAstNode(pattern.left)) visitPattern(pattern.left, [...ancestors, pattern]);
        return;
      case "ArrayPattern":
        if (Array.isArray(pattern.elements)) {
          const next = [...ancestors, pattern];
          for (const elem of pattern.elements) {
            if (isAstNode(elem)) visitPattern(elem, next);
          }
        }
        return;
      case "ObjectPattern":
        if (Array.isArray(pattern.properties)) {
          const next = [...ancestors, pattern];
          for (const prop of pattern.properties) {
            if (!isAstNode(prop)) continue;
            if (prop.type === "RestElement" && isAstNode(prop.argument)) {
              visitPattern(prop.argument, [...next, prop]);
            } else if (prop.type === "ObjectProperty") {
              if (prop.computed && isAstNode(prop.key)) visit(prop.key, [...next, prop], false);
              if (isAstNode(prop.value)) visitPattern(prop.value, [...next, prop]);
            }
          }
        }
        return;
      default:
        visit(pattern, ancestors, false);
    }
  };

  const walkChildren = (node: JsAstNode, ancestors: JsAstNode[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (AST_METADATA_KEYS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item, ancestors, false);
        }
      } else if (isAstNode(value)) {
        visit(value, ancestors, false);
      }
    }
  };

  visit(root, [], false);
  return refs;
}

function isWriteContext(node: JsAstNode, parent: JsAstNode | undefined): boolean {
  if (!parent) return false;
  if (parent.type === "AssignmentExpression" && parent.left === node) return true;
  if (parent.type === "UpdateExpression" && parent.argument === node) return true;
  if (
    parent.type === "UnaryExpression" &&
    parent.operator === "delete" &&
    parent.argument === node
  ) {
    return true;
  }
  if (
    (parent.type === "ForInStatement" || parent.type === "ForOfStatement") &&
    parent.left === node
  ) {
    return true;
  }
  return false;
}

function verifyReadOnlyTreeAliasInHandler(
  fnDecl: JsAstNode,
  treeRef: JsAstNode,
  treeAncestors: JsAstNode[],
  interopParam: string,
  routeModVar: string,
): boolean {
  // Next's `handleRequest` wraps `tree` into `const ComponentMod = { ...entryBase, tree, ... }`,
  // embeds `ComponentMod` and `interopDefault(ComponentMod)` in `context.renderOpts`,
  // and passes `context` directly to `routeModule.render`/`prerender` (or a local
  // `invokeRouteModule` helper that forwards its context parameter untouched).
  // Reject any other alias or escape so the handler cannot mutate `tree` through an alias.
  const propNode = treeAncestors.at(-1);
  const compObj = treeAncestors.at(-2);
  const compDecl = treeAncestors.at(-3);
  if (
    !propNode ||
    propNode.type !== "ObjectProperty" ||
    !(propNode.value === treeRef || (propNode.key === treeRef && Boolean(propNode.shorthand))) ||
    !compObj ||
    compObj.type !== "ObjectExpression" ||
    !compDecl ||
    compDecl.type !== "VariableDeclarator" ||
    !isAstNode(compDecl.id) ||
    compDecl.id.type !== "Identifier" ||
    typeof compDecl.id.name !== "string"
  ) {
    return false;
  }
  const compModVar = compDecl.id.name;
  // Find the nearest enclosing BlockStatement containing `compDecl`.
  let compScopeIdx = -1;
  for (let i = treeAncestors.length - 4; i >= 0; i -= 1) {
    if (treeAncestors[i]!.type === "BlockStatement") {
      compScopeIdx = i;
      break;
    }
  }
  if (compScopeIdx === -1) return false;
  const compScopeBlock = treeAncestors[compScopeIdx]!;
  const compScopePrefix = treeAncestors.slice(0, compScopeIdx);

  const resolveLexicalHelperFunction = (
    helperName: string,
    callAncestors: readonly JsAstNode[],
  ): JsAstNode | undefined => {
    // Walk lexical scopes outward from the call site to `fnDecl` so a minified
    // name reused in an unrelated sibling block cannot shadow or conflict with
    // the binding actually invoked at this call site.
    for (let i = callAncestors.length - 1; i >= 0; i -= 1) {
      const scope = callAncestors[i]!;
      if (
        scope.type === "FunctionDeclaration" ||
        scope.type === "FunctionExpression" ||
        scope.type === "ArrowFunctionExpression" ||
        scope.type === "ObjectMethod" ||
        scope.type === "ClassMethod" ||
        scope.type === "ClassPrivateMethod"
      ) {
        const paramNames = new Set<string>();
        if (Array.isArray(scope.params)) {
          for (const p of scope.params) {
            if (isAstNode(p)) collectPatternBindingNames(p, paramNames);
          }
        }
        if (paramNames.has(helperName)) return;
        if (
          scope.type === "FunctionExpression" &&
          isAstNode(scope.id) &&
          scope.id.type === "Identifier" &&
          scope.id.name === helperName
        ) {
          return scope;
        }
        if (scope === fnDecl) break;
        continue;
      }

      if (scope.type === "CatchClause") {
        if (isAstNode(scope.param)) {
          const catchNames = new Set<string>();
          collectPatternBindingNames(scope.param, catchNames);
          if (catchNames.has(helperName)) return;
        }
        continue;
      }

      if (scope.type === "BlockStatement" && Array.isArray(scope.body)) {
        const matches: Array<{ fn: JsAstNode; declNode: JsAstNode }> = [];
        for (const stmt of scope.body as JsAstNode[]) {
          if (
            stmt.type === "FunctionDeclaration" &&
            isAstNode(stmt.id) &&
            stmt.id.type === "Identifier" &&
            stmt.id.name === helperName
          ) {
            matches.push({ fn: stmt, declNode: stmt });
          } else if (
            stmt.type === "ClassDeclaration" &&
            isAstNode(stmt.id) &&
            stmt.id.type === "Identifier" &&
            stmt.id.name === helperName
          ) {
            return;
          } else if (stmt.type === "VariableDeclaration" && Array.isArray(stmt.declarations)) {
            for (const decl of stmt.declarations) {
              if (!isAstNode(decl) || !isAstNode(decl.id)) continue;
              const bound = new Set<string>();
              collectPatternBindingNames(decl.id, bound);
              if (!bound.has(helperName)) continue;
              if (
                decl.id.type === "Identifier" &&
                decl.id.name === helperName &&
                isAstNode(decl.init) &&
                (decl.init.type === "ArrowFunctionExpression" ||
                  decl.init.type === "FunctionExpression")
              ) {
                matches.push({ fn: decl.init, declNode: decl });
              } else {
                return;
              }
            }
          }
        }
        if (matches.length > 1) return;
        if (matches.length === 1) {
          const { fn, declNode } = matches[0]!;
          for (const ref of collectLexicalScopeRefs(scope, helperName, declNode)) {
            if (isWriteContext(ref.node, ref.ancestors.at(-1))) return;
          }
          return fn;
        }
        // If this block is a function body, also check for hoisted `var`
        // declarations inside nested blocks so we fail closed if shadowed.
        const scopeParent = i > 0 ? callAncestors[i - 1] : undefined;
        if (
          scopeParent &&
          (scopeParent.type === "FunctionDeclaration" ||
            scopeParent.type === "FunctionExpression" ||
            scopeParent.type === "ArrowFunctionExpression" ||
            scopeParent.type === "ObjectMethod" ||
            scopeParent.type === "ClassMethod" ||
            scopeParent.type === "ClassPrivateMethod")
        ) {
          const hoistedVars = new Set<string>();
          collectHoistedVarBindings(scope, hoistedVars);
          if (hoistedVars.has(helperName)) return;
        }
      }
    }
    return;
  };

  const isVerifiedRenderCall = (
    callNode: JsAstNode,
    callAncestors: readonly JsAstNode[],
    argNode: JsAstNode,
  ): boolean => {
    if (
      callNode.type !== "CallExpression" ||
      !isAstNode(callNode.callee) ||
      !Array.isArray(callNode.arguments)
    ) {
      return false;
    }
    const argIndex = (callNode.arguments as JsAstNode[]).indexOf(argNode);
    if (argIndex === -1) return false;
    if (isRouteModuleRenderCall(callNode.callee, routeModVar)) return true;

    const helperName = unwrapIndirectCalleeIdent(callNode.callee);
    if (!helperName) return false;
    const helperFn = resolveLexicalHelperFunction(helperName, callAncestors);
    if (!helperFn) return false;
    if (!Array.isArray(helperFn.params) || argIndex >= helperFn.params.length) return false;
    const paramNode = helperFn.params[argIndex];
    if (
      !isAstNode(paramNode) ||
      paramNode.type !== "Identifier" ||
      typeof paramNode.name !== "string" ||
      !isAstNode(helperFn.body)
    ) {
      return false;
    }
    const paramName = paramNode.name;
    const paramRefs = collectLexicalScopeRefs(helperFn.body, paramName, undefined);
    if (paramRefs.length === 0) return false;
    for (const pRef of paramRefs) {
      const pParent = pRef.ancestors.at(-1);
      if (
        !pParent ||
        pParent.type !== "CallExpression" ||
        !isAstNode(pParent.callee) ||
        !isRouteModuleRenderCall(pParent.callee, routeModVar) ||
        !Array.isArray(pParent.arguments) ||
        !(pParent.arguments as JsAstNode[]).includes(pRef.node)
      ) {
        return false;
      }
    }
    return true;
  };

  const ctxTargets: Array<{
    ctxVar: string;
    ctxDecl: JsAstNode;
    ctxScope: JsAstNode;
    ctxScopePrefix: JsAstNode[];
  }> = [];
  const compRefs = collectLexicalScopeRefs(compScopeBlock, compModVar, compDecl);
  for (const ref of compRefs) {
    const parent = ref.ancestors.at(-1);
    if (!parent || isWriteContext(ref.node, parent)) return false;
    // Allow `interopDefault(ComponentMod)` (exact 1-argument call).
    if (
      parent.type === "CallExpression" &&
      isAstNode(parent.callee) &&
      unwrapIndirectCalleeIdent(parent.callee) === interopParam &&
      Array.isArray(parent.arguments) &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === ref.node
    ) {
      continue;
    }
    // Allow embedding `ComponentMod` inside `renderOpts: { ..., ComponentMod, ... }`
    // of a `context` object passed straight to `routeModule.render`/`prerender`.
    const renderOptsObj = ref.ancestors.at(-2);
    const renderOptsProp = ref.ancestors.at(-3);
    const ctxObj = ref.ancestors.at(-4);
    const ctxOwner = ref.ancestors.at(-5);
    if (
      parent.type === "ObjectProperty" &&
      (parent.value === ref.node || (parent.key === ref.node && Boolean(parent.shorthand))) &&
      renderOptsObj?.type === "ObjectExpression" &&
      renderOptsProp?.type === "ObjectProperty" &&
      renderOptsProp.value === renderOptsObj &&
      ctxObj?.type === "ObjectExpression" &&
      ctxOwner
    ) {
      if (
        ctxOwner.type === "VariableDeclarator" &&
        isAstNode(ctxOwner.id) &&
        ctxOwner.id.type === "Identifier" &&
        typeof ctxOwner.id.name === "string"
      ) {
        let ctxScopeIdx = -1;
        for (let i = ref.ancestors.length - 6; i >= 0; i -= 1) {
          if (ref.ancestors[i]!.type === "BlockStatement") {
            ctxScopeIdx = i;
            break;
          }
        }
        if (ctxScopeIdx === -1) return false;
        ctxTargets.push({
          ctxVar: ctxOwner.id.name,
          ctxDecl: ctxOwner,
          ctxScope: ref.ancestors[ctxScopeIdx]!,
          ctxScopePrefix: [...compScopePrefix, ...ref.ancestors.slice(0, ctxScopeIdx)],
        });
        continue;
      }
      if (
        isVerifiedRenderCall(ctxOwner, [...compScopePrefix, ...ref.ancestors.slice(0, -5)], ctxObj)
      ) {
        continue;
      }
    }
    return false;
  }

  for (const { ctxVar, ctxDecl, ctxScope, ctxScopePrefix } of ctxTargets) {
    const ctxRefs = collectLexicalScopeRefs(ctxScope, ctxVar, ctxDecl);
    for (const cRef of ctxRefs) {
      const cParent = cRef.ancestors.at(-1);
      if (!cParent || isWriteContext(cRef.node, cParent)) return false;
      if (
        !isVerifiedRenderCall(
          cParent,
          [...ctxScopePrefix, ...cRef.ancestors.slice(0, -1)],
          cRef.node,
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function verifyEntrypointRuntimeBodyUses(
  fnBody: string,
  treeParam: string,
  routeModVar: string,
  routeModDeclOffset: number,
  interopParam: string,
): boolean {
  const program = parseJsProgram(fnBody);
  if (!program || !Array.isArray(program.body) || program.body.length === 0) return false;

  const statements = program.body as JsAstNode[];
  const finalReturn = statements.at(-1);
  if (!finalReturn || finalReturn.type !== "ReturnStatement") return false;

  const fnDeclNames = new Set<string>();
  let routeModDeclarator: JsAstNode | undefined;
  for (const stmt of statements) {
    if (
      stmt.type === "FunctionDeclaration" &&
      isAstNode(stmt.id) &&
      stmt.id.type === "Identifier" &&
      typeof stmt.id.name === "string"
    ) {
      fnDeclNames.add(stmt.id.name);
    } else if (stmt.type === "VariableDeclaration" && Array.isArray(stmt.declarations)) {
      for (const decl of stmt.declarations) {
        if (
          isAstNode(decl) &&
          isAstNode(decl.id) &&
          decl.id.type === "Identifier" &&
          decl.id.name === routeModVar &&
          decl.id.start === routeModDeclOffset
        ) {
          routeModDeclarator = decl;
        }
      }
    }
  }
  if (!routeModDeclarator || !isAstNode(routeModDeclarator.init)) return false;
  const ctorNew = routeModDeclarator.init;
  if (
    ctorNew.type !== "NewExpression" ||
    !Array.isArray(ctorNew.arguments) ||
    ctorNew.arguments.length !== 1 ||
    !isAstNode(ctorNew.arguments[0])
  ) {
    return false;
  }
  const userlandProp = findObjectPropertyNode(ctorNew.arguments[0], "userland");
  const loaderTreeProp =
    userlandProp && isAstNode(userlandProp.value)
      ? findObjectPropertyNode(userlandProp.value, "loaderTree")
      : undefined;
  const allowedTreeNode =
    loaderTreeProp && isAstNode(loaderTreeProp.value) ? loaderTreeProp.value : undefined;
  if (
    !allowedTreeNode ||
    allowedTreeNode.type !== "Identifier" ||
    allowedTreeNode.name !== treeParam
  ) {
    return false;
  }

  let ok = true;
  let currentFnDecl: JsAstNode | undefined;
  const checkNode = (
    node: JsAstNode,
    ancestors: JsAstNode[],
    shadowed: ReadonlySet<string>,
    mode: "top-level" | "fn-decl",
  ): void => {
    if (!ok) return;
    const parent = ancestors.at(-1);

    // Skip binding identifiers in variable/function/class declarations while
    // still inspecting executable expressions (defaults, computed keys, inits).
    if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
      const nextAncestors = [...ancestors, node];
      for (const decl of node.declarations) {
        if (!ok || !isAstNode(decl)) continue;
        if (decl === routeModDeclarator) {
          checkNode(ctorNew, [...nextAncestors, decl], shadowed, mode);
          continue;
        }
        if (isAstNode(decl.id))
          checkPatternExprs(decl.id, [...nextAncestors, decl], shadowed, mode);
        if (ok && isAstNode(decl.init)) {
          checkNode(decl.init, [...nextAncestors, decl], shadowed, mode);
        }
      }
      return;
    }

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      const nextAncestors = [...ancestors, node];
      if (
        (node.type === "ObjectMethod" || node.type === "ClassMethod") &&
        node.computed &&
        isAstNode(node.key)
      ) {
        checkNode(node.key, nextAncestors, shadowed, mode);
        if (!ok) return;
      }
      const nextShadowed = new Set(shadowed);
      if (
        node.type === "FunctionExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        typeof node.id.name === "string"
      ) {
        nextShadowed.add(node.id.name);
      }
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (isAstNode(param)) collectPatternBindingNames(param, nextShadowed);
        }
        for (const param of node.params) {
          if (ok && isAstNode(param)) checkPatternExprs(param, nextAncestors, nextShadowed, mode);
        }
      }
      if (ok && isAstNode(node.body)) {
        const bodyShadowed = new Set(nextShadowed);
        collectHoistedVarBindings(node.body, bodyShadowed);
        checkNode(node.body, nextAncestors, bodyShadowed, mode);
      }
      return;
    }

    if (node.type === "BlockStatement" || node.type === "StaticBlock") {
      const nextShadowed = new Set(shadowed);
      if (Array.isArray(node.body)) collectLexicalStatementBindings(node.body, nextShadowed);
      walkChildren(node, [...ancestors, node], nextShadowed, mode);
      return;
    }

    if (node.type === "SwitchStatement") {
      const nextAncestors = [...ancestors, node];
      if (isAstNode(node.discriminant)) checkNode(node.discriminant, nextAncestors, shadowed, mode);
      if (!ok || !Array.isArray(node.cases)) return;
      const nextShadowed = new Set(shadowed);
      for (const c of node.cases) {
        if (isAstNode(c) && Array.isArray(c.consequent)) {
          collectLexicalStatementBindings(c.consequent, nextShadowed);
        }
      }
      for (const c of node.cases) {
        if (ok && isAstNode(c)) checkNode(c, nextAncestors, nextShadowed, mode);
      }
      return;
    }

    if (node.type === "ForStatement") {
      const nextShadowed = new Set(shadowed);
      if (
        isAstNode(node.init) &&
        node.init.type === "VariableDeclaration" &&
        node.init.kind !== "var"
      ) {
        collectLexicalStatementBindings([node.init], nextShadowed);
      }
      walkChildren(node, [...ancestors, node], nextShadowed, mode);
      return;
    }

    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const nextShadowed = new Set(shadowed);
      if (
        isAstNode(node.left) &&
        node.left.type === "VariableDeclaration" &&
        node.left.kind !== "var"
      ) {
        collectLexicalStatementBindings([node.left], nextShadowed);
      }
      walkChildren(node, [...ancestors, node], nextShadowed, mode);
      return;
    }

    if (node.type === "CatchClause") {
      const nextAncestors = [...ancestors, node];
      const nextShadowed = new Set(shadowed);
      if (isAstNode(node.param)) {
        collectPatternBindingNames(node.param, nextShadowed);
        checkPatternExprs(node.param, nextAncestors, nextShadowed, mode);
      }
      if (ok && isAstNode(node.body)) checkNode(node.body, nextAncestors, nextShadowed, mode);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const nextAncestors = [...ancestors, node];
      if (isAstNode(node.superClass)) checkNode(node.superClass, nextAncestors, shadowed, mode);
      if (!ok) return;
      const nextShadowed = new Set(shadowed);
      if (
        node.type === "ClassExpression" &&
        isAstNode(node.id) &&
        node.id.type === "Identifier" &&
        typeof node.id.name === "string"
      ) {
        nextShadowed.add(node.id.name);
      }
      if (isAstNode(node.body)) checkNode(node.body, nextAncestors, nextShadowed, mode);
      return;
    }

    if (isIdentifierReference(node, parent)) {
      const name = node.name as string;
      if (!shadowed.has(name)) {
        if (mode === "top-level") {
          const isAllowedTreeRef =
            name === treeParam &&
            (node === allowedTreeNode ||
              (parent === loaderTreeProp &&
                parent?.type === "ObjectProperty" &&
                Boolean(parent.shorthand)));
          if (
            (name === treeParam && !isAllowedTreeRef) ||
            name === routeModVar ||
            fnDeclNames.has(name)
          ) {
            ok = false;
            return;
          }
        } else if (name === treeParam) {
          if (
            !currentFnDecl ||
            !verifyReadOnlyTreeAliasInHandler(
              currentFnDecl,
              node,
              ancestors,
              interopParam,
              routeModVar,
            )
          ) {
            ok = false;
            return;
          }
        } else if (name === routeModVar) {
          if (
            parent &&
            (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
            parent.object === node &&
            (parent.computed || getMemberPropertyName(parent) === "userland")
          ) {
            ok = false;
            return;
          }
          if (
            parent?.type === "CallExpression" &&
            isAstNode(parent.callee) &&
            isObjectOrReflectMutationCallee(parent.callee) &&
            Array.isArray(parent.arguments) &&
            parent.arguments.includes(node)
          ) {
            ok = false;
            return;
          }
        }
      }
    }

    walkChildren(node, [...ancestors, node], shadowed, mode);
  };

  const checkPatternExprs = (
    pattern: JsAstNode,
    ancestors: JsAstNode[],
    shadowed: ReadonlySet<string>,
    mode: "top-level" | "fn-decl",
  ): void => {
    if (!ok) return;
    switch (pattern.type) {
      case "Identifier":
        return;
      case "RestElement":
      case "SpreadElement":
        if (isAstNode(pattern.argument)) {
          checkPatternExprs(pattern.argument, [...ancestors, pattern], shadowed, mode);
        }
        return;
      case "AssignmentPattern":
        if (isAstNode(pattern.right)) {
          checkNode(pattern.right, [...ancestors, pattern], shadowed, mode);
        }
        if (ok && isAstNode(pattern.left)) {
          checkPatternExprs(pattern.left, [...ancestors, pattern], shadowed, mode);
        }
        return;
      case "ArrayPattern":
        if (Array.isArray(pattern.elements)) {
          const next = [...ancestors, pattern];
          for (const elem of pattern.elements) {
            if (ok && isAstNode(elem)) checkPatternExprs(elem, next, shadowed, mode);
          }
        }
        return;
      case "ObjectPattern":
        if (Array.isArray(pattern.properties)) {
          const next = [...ancestors, pattern];
          for (const prop of pattern.properties) {
            if (!ok || !isAstNode(prop)) continue;
            if (prop.type === "RestElement" && isAstNode(prop.argument)) {
              checkPatternExprs(prop.argument, [...next, prop], shadowed, mode);
            } else if (prop.type === "ObjectProperty") {
              if (prop.computed && isAstNode(prop.key)) {
                checkNode(prop.key, [...next, prop], shadowed, mode);
              }
              if (ok && isAstNode(prop.value)) {
                checkPatternExprs(prop.value, [...next, prop], shadowed, mode);
              }
            }
          }
        }
        return;
      default:
        checkNode(pattern, ancestors, shadowed, mode);
    }
  };

  const walkChildren = (
    node: JsAstNode,
    ancestors: JsAstNode[],
    shadowed: ReadonlySet<string>,
    mode: "top-level" | "fn-decl",
  ): void => {
    for (const [key, value] of Object.entries(node)) {
      if (!ok) return;
      if (AST_METADATA_KEYS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!ok) return;
          if (isAstNode(item)) checkNode(item, ancestors, shadowed, mode);
        }
      } else if (isAstNode(value)) {
        checkNode(value, ancestors, shadowed, mode);
      }
    }
  };

  const emptyShadowed = new Set<string>();
  for (const stmt of statements) {
    if (!ok) return false;
    if (stmt === finalReturn) continue;
    if (stmt.type === "FunctionDeclaration") {
      currentFnDecl = stmt;
      checkNode(stmt, [program], emptyShadowed, "fn-decl");
      currentFnDecl = undefined;
    } else {
      checkNode(stmt, [program], emptyShadowed, "top-level");
    }
  }
  return ok;
}

function extractVerifiedAppPageModuleIdFromRuntimeFactory(
  factory: string,
  runtimeModuleId: string,
  exportName: string,
): string | null {
  const parsed = parseTurbopackFactory(factory);
  if (!parsed) return null;
  const fnSource = extractTurbopackExportedFunction(
    parsed.body,
    parsed.param,
    runtimeModuleId,
    exportName,
  );
  if (!fnSource) return null;

  // Verify signature: `function({ tree: O, page: P, pathname: Q, require: R, loadChunk: S, interopDefault: T }) { ... }`
  const openParen = fnSource.indexOf("(");
  if (openParen === -1) return null;
  const closeParen = scanBalancedEnd(fnSource, openParen);
  if (closeParen === -1) return null;
  const paramText = fnSource.slice(openParen + 1, closeParen - 1).trim();
  const paramProps = parseTopLevelObjectProperties(paramText);
  if (!paramProps) return null;
  const treeParam = paramProps.get("tree");
  const pageParam = paramProps.get("page");
  const pathnameParam = paramProps.get("pathname");
  const reqParam = paramProps.get("require");
  const loadChunkParam = paramProps.get("loadChunk");
  const interopParam = paramProps.get("interopDefault");
  const identRe = /^[A-Za-z_$][\w$]*$/u;
  if (
    !treeParam ||
    !pageParam ||
    !pathnameParam ||
    !reqParam ||
    !loadChunkParam ||
    !interopParam ||
    !identRe.test(treeParam) ||
    !identRe.test(pageParam) ||
    !identRe.test(pathnameParam) ||
    !identRe.test(reqParam) ||
    !identRe.test(loadChunkParam) ||
    !identRe.test(interopParam)
  ) {
    return null;
  }

  const bodyOpen = skipWhitespaceAndComments(fnSource, closeParen);
  if (fnSource[bodyOpen] !== "{") return null;
  const bodyClose = scanBalancedEnd(fnSource, bodyOpen);
  if (bodyClose !== fnSource.length) return null;
  const fnBody = fnSource.slice(bodyOpen + 1, bodyClose - 1);

  // Verify the straight-line prefix at function entry constructs Next's
  // `AppPageRouteModule` directly from the unmodified `tree`, `page`, and
  // `pathname` parameters (supporting both minified dot-member and unminified
  // bracket-member forms: `new ns.AppPageRouteModule(` and `new ns["AppPageRouteModule"](`).
  const prefixMatch = new RegExp(
    `^(\\s*(?:["']use strict["']\\s*;?\\s*)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\{\\s*require\\s*:\\s*${escapeRegExpLiteral(reqParam)}\\s*,\\s*loadChunk\\s*:\\s*${escapeRegExpLiteral(loadChunkParam)}\\s*,?\\s*\\}\\s*(?:,\\s*|;\\s*(?:const|let|var)\\s+))([A-Za-z_$][\\w$]*)\\s*=\\s*new\\s+([A-Za-z_$][\\w$]*)\\s*(?:\\.\\s*AppPageRouteModule|\\[\\s*["']AppPageRouteModule["']\\s*\\])\\s*\\(`,
    "u",
  ).exec(fnBody);
  if (!prefixMatch) return null;
  const [, beforeRouteMod, nextAppVar, routeModVar, appPageNs] = prefixMatch;
  const ctorParen = prefixMatch[0].length - 1;
  const ctorEnd = scanBalancedEnd(fnBody, ctorParen);
  if (ctorEnd === -1) return null;
  const ctorArgsText = fnBody.slice(ctorParen + 1, ctorEnd - 1).trim();
  const ctorArgs = parseTopLevelObjectProperties(ctorArgsText);
  if (!ctorArgs) return null;
  const defProps = parseTopLevelObjectProperties(ctorArgs.get("definition") ?? "");
  const userlandProps = parseTopLevelObjectProperties(ctorArgs.get("userland") ?? "");
  if (!defProps || !userlandProps) return null;
  if (userlandProps.get("loaderTree")?.trim() !== treeParam) return null;
  if (defProps.get("page")?.trim() !== pageParam) return null;
  if (defProps.get("pathname")?.trim() !== pathnameParam) return null;
  if (
    !/^(?:[A-Za-z_$][\w$]*\s*(?:\.\s*RouteKind|\[\s*["']RouteKind["']\s*\])|RouteKind)\s*(?:\.\s*APP_PAGE|\[\s*["']APP_PAGE["']\s*\])$/u.test(
      defProps.get("kind") ?? "",
    )
  ) {
    return null;
  }

  // Verify the function returns `{ __next_app__: nextAppVar, routeModule: routeModVar, handler: ... }`
  // and neither `treeParam` nor `routeModVar` is mutated, reassigned, or
  // indirectly tampered with via calls (such as `Object.assign`).
  const returnMatch = /return\s*(\{[^{}]*\})\s*;?\s*$/u.exec(fnBody);
  if (!returnMatch) return null;
  const returnProps = parseTopLevelObjectProperties(returnMatch[1]!);
  if (
    !returnProps ||
    returnProps.get("__next_app__")?.trim() !== nextAppVar ||
    returnProps.get("routeModule")?.trim() !== routeModVar ||
    !identRe.test(returnProps.get("handler")?.trim() ?? "")
  ) {
    return null;
  }
  const routeModDeclOffset = beforeRouteMod!.length;
  if (hasWriteToIdentifier(fnBody, treeParam)) return null;
  if (hasWriteToIdentifier(fnBody, routeModVar!, routeModDeclOffset)) return null;
  if (
    !verifyEntrypointRuntimeBodyUses(
      fnBody,
      treeParam,
      routeModVar!,
      routeModDeclOffset,
      interopParam,
    )
  ) {
    return null;
  }

  return resolveUniqueTopLevelImportSource(parsed.body, appPageNs!, parsed.param) ?? null;
}

function verifyTurbopackAppPageRuntimeExport(
  runtimeModuleId: string,
  exportName: string,
  resolveModule: TurbopackModuleResolver,
): boolean {
  const factory = resolveModule(runtimeModuleId);
  if (typeof factory !== "string") return false;
  const runtimeVerifyCache = RESOLVER_RUNTIME_VERIFY_CACHE.get(resolveModule);
  const cacheKey = `${runtimeModuleId}\0${exportName}\0${factory}`;
  let appPageModId = runtimeVerifyCache?.get(cacheKey);
  if (appPageModId === undefined) {
    appPageModId = extractVerifiedAppPageModuleIdFromRuntimeFactory(
      factory,
      runtimeModuleId,
      exportName,
    );
    runtimeVerifyCache?.set(cacheKey, appPageModId);
  }
  if (!appPageModId) return false;
  // Always prove `appPageModId` resolves to Next's real external
  // `AppPageRouteModule` runtime module using this route's own resolver so
  // route-specific ambiguity or conflicting chunks still fail closed.
  return isNextAppPageExternalModule(appPageModId, resolveModule);
}

function parseCalleeMemberAccess(calleeText: string): { ns: string; prop: string } | undefined {
  let inner = calleeText.trim();
  const indirect = /^\(\s*0\s*,\s*([\s\S]+?)\s*\)$/u.exec(inner);
  if (indirect) inner = indirect[1]!.trim();

  const dotMatch = /^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)$/u.exec(inner);
  if (dotMatch) return { ns: dotMatch[1]!, prop: dotMatch[2]! };

  const bracketMatch =
    /^([A-Za-z_$][\w$]*)\s*\[\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]$/u.exec(inner);
  if (bracketMatch) {
    const prop = parseJsStringLiteral(bracketMatch[2]!);
    if (prop) return { ns: bracketMatch[1]!, prop };
  }
  return;
}

function verifyCalleeIsNextEntrypoint(
  scopeSource: string,
  calleeText: string,
  moduleParam: string | undefined,
  resolveTurbopackModule: TurbopackModuleResolver,
): boolean {
  const member = parseCalleeMemberAccess(calleeText);
  if (member) {
    const importSource = resolveUniqueTopLevelImportSource(scopeSource, member.ns, moduleParam);
    if (!importSource) return false;
    if (moduleParam !== undefined) {
      return verifyTurbopackAppPageRuntimeExport(importSource, member.prop, resolveTurbopackModule);
    }
    return (
      member.prop === "createAppPageEntrypoint" &&
      NEXT_APP_PAGE_RUNTIME_SPECIFIER.test(importSource)
    );
  }
  if (moduleParam === undefined && calleeText === "createAppPageEntrypoint") {
    return isImportedDirectCreateAppPageEntrypoint(scopeSource);
  }
  return false;
}

type TurbopackEsmBinding =
  | { name: string; kind: "value"; expr: string }
  | { name: string; kind: "getter"; getterExpr: string; setterExpr?: string };

function parseTurbopackEsmExportBindings(
  elements: readonly string[],
): TurbopackEsmBinding[] | undefined {
  const bindings: TurbopackEsmBinding[] = [];
  let idx = 0;
  while (idx < elements.length) {
    const name = parseJsStringLiteral(elements[idx]!);
    if (name === undefined) return;
    idx += 1;
    if (idx >= elements.length) return;
    const second = elements[idx]!.trim();
    if (second === "0") {
      if (idx + 1 >= elements.length) return;
      bindings.push({ name, kind: "value", expr: elements[idx + 1]!.trim() });
      idx += 2;
      continue;
    }
    const getterExpr = second;
    idx += 1;
    // Turbopack emits an optional live-binding setter function as a 3rd element
    // (`"g", () => k, a => k = a`) whenever the next element is not a string name.
    let setterExpr: string | undefined;
    if (idx < elements.length && parseJsStringLiteral(elements[idx]!) === undefined) {
      setterExpr = elements[idx]!.trim();
      idx += 1;
    }
    bindings.push({ name, kind: "getter", getterExpr, setterExpr });
  }
  return bindings;
}

function isSimpleSetterForIdentifier(setterExpr: string, ident: string): boolean {
  const trimmed = stripOuterParens(setterExpr);
  const arrowMatch =
    /^(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*(?:\{\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*\}|\(?\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\)?)$/u.exec(
      trimmed,
    );
  if (!arrowMatch) return false;
  const param = arrowMatch[1] ?? arrowMatch[2];
  const lhs = arrowMatch[3] ?? arrowMatch[5];
  const rhs = arrowMatch[4] ?? arrowMatch[6];
  return param !== undefined && lhs === ident && rhs === param;
}

function parseTurbopackTargetModuleArg(
  source: string,
  afterArray: number,
  callEnd: number,
): { status: "default" } | { status: "target"; moduleId: string } | { status: "invalid" } {
  if (source[afterArray] !== ",") return { status: "default" };
  const rest = source.slice(afterArray + 1, callEnd - 1).trim();
  const args = splitTopLevelArrayElements(`[${rest}]`, 0);
  if (!args || args.length === 0) return { status: "invalid" };
  const idArg = args[0]!.trim();
  if (idArg === "null" || idArg === "undefined" || idArg === "void 0") {
    return { status: "default" };
  }
  const moduleId = normalizeTurbopackModuleId(idArg);
  if (!moduleId) return { status: "invalid" };
  return { status: "target", moduleId };
}

function parseRouteModuleMemberChain(
  rhsExpr: string,
  body: string,
  moduleParam: string,
): { targetModuleId: string; exportName: string } | undefined {
  const trimmed = stripOuterParens(rhsExpr);
  const routePropMatch =
    /^([\s\S]+?)\s*(?:\.\s*routeModule|\[\s*(?:"routeModule"|'routeModule')\s*\])$/u.exec(trimmed);
  if (!routePropMatch) return;
  const base = stripOuterParens(routePropMatch[1]!);

  // Case 1: `<ns>.<exportName>` or `<ns>["<exportName>"]` where `ns = a.i(targetId)`
  const nsMember = parseCalleeMemberAccess(base);
  if (nsMember) {
    const targetModuleId = resolveUniqueTopLevelImportSource(body, nsMember.ns, moduleParam);
    if (targetModuleId) {
      return { targetModuleId, exportName: nsMember.prop };
    }
  }

  // Case 2: inline `<moduleParam>.i(<targetId>).<exportName>` or `["<exportName>"]`
  const inlineImportMatch = new RegExp(
    `^${escapeRegExpLiteral(moduleParam)}\\s*\\.\\s*[ir]\\s*\\(\\s*(\\d+(?:\\.\\d+)?(?:[eE]\\+?\\d+)?|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\])$`,
    "u",
  ).exec(base);
  if (inlineImportMatch) {
    const targetModuleId = normalizeTurbopackModuleId(inlineImportMatch[1]!);
    const prop =
      inlineImportMatch[2] ??
      (inlineImportMatch[3] ? parseJsStringLiteral(inlineImportMatch[3]) : undefined);
    if (targetModuleId && prop) {
      return { targetModuleId, exportName: prop };
    }
  }

  return;
}

function resolveUniqueRouteModuleLocal(
  body: string,
  localIdent: string,
  moduleParam: string,
  requireConst: boolean,
  exportCallSpan: [number, number],
): { targetModuleId: string; exportName: string } | undefined {
  let found:
    | { targetModuleId: string; exportName: string; declStart: number; isConst: boolean }
    | undefined;
  let declKind: "let" | "const" | "var" | undefined;
  let exprDepth = 0;
  let pendingCondition = false;
  let conditionalStmt = false;
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let prevWord = "";
  let regexAllowed = true;
  let index = 0;

  while (index < body.length) {
    const ch = body[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (body[index + 1] === "/" || body[index + 1] === "*")) {
      index = skipWhitespaceAndComments(body, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(body, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(body, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(body, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        prevWord = "";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      const end = scanBalancedEnd(body, index);
      if (end === -1) return;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      conditionalStmt = false;
      pendingCondition = false;
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (exprDepth > 0) exprDepth -= 1;
      let closedCondition = false;
      if (ch === ")" && exprDepth === 0 && pendingCondition) {
        pendingCondition = false;
        conditionalStmt = true;
        closedCondition = true;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      regexAllowed = closedCondition;
      continue;
    }
    if (ch === ";") {
      if (exprDepth === 0) {
        declKind = undefined;
        conditionalStmt = false;
        pendingCondition = false;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      regexAllowed = true;
      continue;
    }
    if (ch === ",") {
      index += 1;
      prevTokenKind = "comma";
      prevWord = "";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      index += 1;
      prevTokenKind = "dot";
      prevWord = "";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < body.length && /[\w$]/u.test(body[index] ?? "")) index += 1;
      const word = body.slice(wordStart, index);
      if (prevTokenKind !== "dot" && exprDepth === 0) {
        if (word === "let" || word === "const" || word === "var") {
          declKind = word;
          prevTokenKind = "decl";
          prevWord = word;
          regexAllowed = false;
          continue;
        }
        if (CONTROL_FLOW_KEYWORDS.has(word) || word === "for") {
          pendingCondition = true;
          prevTokenKind = "other";
          prevWord = word;
          regexAllowed = false;
          continue;
        }
        if (word === "else" || word === "do") {
          conditionalStmt = true;
          prevTokenKind = "other";
          prevWord = word;
          regexAllowed = true;
          continue;
        }
        if (word === localIdent) {
          if (prevWord === "function" || prevWord === "class") return;
          const isDeclarator =
            prevTokenKind === "decl" || (prevTokenKind === "comma" && declKind !== undefined);
          if (isDeclarator) {
            if (found !== undefined || conditionalStmt) return;
            const afterWord = skipWhitespaceAndComments(body, index);
            if (
              body[afterWord] !== "=" ||
              body[afterWord + 1] === "=" ||
              body[afterWord + 1] === ">"
            ) {
              return;
            }
            const rhsStart = skipWhitespaceAndComments(body, afterWord + 1);
            // Scan the initializer expression until top-level `;`, `,`, `}`, or newline.
            let cursor = rhsStart;
            let rhsDepth = 0;
            while (cursor < body.length) {
              const rch = body[cursor];
              if (rch === '"' || rch === "'") {
                const end = scanQuotedStringEnd(body, cursor);
                if (end === -1) return;
                cursor = end;
                continue;
              }
              if (rch === "`") {
                const end = scanTemplateLiteralEnd(body, cursor);
                if (end === -1) return;
                cursor = end;
                continue;
              }
              if (rch === "(" || rch === "[" || rch === "{") {
                const end = scanBalancedEnd(body, cursor);
                if (end === -1) return;
                cursor = end;
                continue;
              }
              if (
                rhsDepth === 0 &&
                (rch === ";" || rch === "," || rch === "}" || rch === "\n" || rch === "\r")
              ) {
                break;
              }
              if (rch === "(" || rch === "[") rhsDepth += 1;
              else if (rch === ")" || rch === "]") rhsDepth = Math.max(0, rhsDepth - 1);
              cursor += 1;
            }
            const rhs = body.slice(rhsStart, cursor).trim();
            const parsedChain = parseRouteModuleMemberChain(rhs, body, moduleParam);
            if (!parsedChain) return;
            found = {
              ...parsedChain,
              declStart: wordStart,
              isConst: declKind === "const",
            };
            index = cursor;
            prevTokenKind = "other";
            prevWord = "";
            regexAllowed = false;
            continue;
          }
        }
      }
      prevTokenKind = "other";
      prevWord = word;
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if ((ch === "+" && body[index + 1] === "+") || (ch === "-" && body[index + 1] === "-")) {
      index += 2;
      prevTokenKind = "other";
      prevWord = "";
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    prevWord = "";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  if (!found) return;
  if (requireConst && !found.isConst) return;
  const [spanStart, spanEnd] = exportCallSpan;
  const bodyWithoutExportCall = `${body.slice(0, spanStart)}${" ".repeat(spanEnd - spanStart)}${body.slice(spanEnd)}`;
  if (hasWriteToIdentifier(bodyWithoutExportCall, localIdent, found.declStart)) return;
  return { targetModuleId: found.targetModuleId, exportName: found.exportName };
}

type TurbopackRouteModuleTargetKind = "route-module-property" | "entrypoint-object";

type TurbopackExportHop =
  | { status: "terminal" }
  | { status: "invalid" }
  | {
      status: "forward";
      targetModuleId: string;
      exportName: string;
      kind: TurbopackRouteModuleTargetKind;
    };

function inspectTurbopackExportHop(
  body: string,
  moduleParam: string,
  expectedModuleId: string,
  wantedExportName: string,
  kind: TurbopackRouteModuleTargetKind,
): TurbopackExportHop {
  const unwrappedBody = unwrapTurbopackCompileTimeBranches(body);
  let forwarded:
    | { targetModuleId: string; exportName: string; kind: TurbopackRouteModuleTargetKind }
    | undefined;
  let directExportFound = false;
  const nestedExportCallPattern = new RegExp(
    `(?:^|[^\\w$.])${escapeRegExpLiteral(moduleParam)}\\s*\\.\\s*[sS]\\s*\\(`,
    "u",
  );
  let hasNestedExportCall = false;
  let exprDepth = 0;
  let pendingCondition = false;
  let conditionalStmt = false;
  let prevTokenKind: "dot" | "other" = "other";
  let regexAllowed = true;
  let index = 0;

  while (index < unwrappedBody.length) {
    const ch = unwrappedBody[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (unwrappedBody[index + 1] === "/" || unwrappedBody[index + 1] === "*")) {
      index = skipWhitespaceAndComments(unwrappedBody, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(unwrappedBody, index);
      if (end === -1) return { status: "invalid" };
      index = end;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(unwrappedBody, index);
      if (end === -1) return { status: "invalid" };
      index = end;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(unwrappedBody, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      const end = scanBalancedEnd(unwrappedBody, index);
      if (end === -1) return { status: "invalid" };
      if (nestedExportCallPattern.test(unwrappedBody.slice(index + 1, end - 1))) {
        hasNestedExportCall = true;
      }
      index = end;
      prevTokenKind = "other";
      conditionalStmt = false;
      pendingCondition = false;
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (exprDepth > 0) exprDepth -= 1;
      let closedCondition = false;
      if (ch === ")" && exprDepth === 0 && pendingCondition) {
        pendingCondition = false;
        conditionalStmt = true;
        closedCondition = true;
      }
      index += 1;
      prevTokenKind = "other";
      regexAllowed = closedCondition;
      continue;
    }
    if (ch === ";") {
      if (exprDepth === 0) {
        conditionalStmt = false;
        pendingCondition = false;
      }
      index += 1;
      prevTokenKind = "other";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      index += 1;
      prevTokenKind = "dot";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < unwrappedBody.length && /[\w$]/u.test(unwrappedBody[index] ?? "")) index += 1;
      const word = unwrappedBody.slice(wordStart, index);
      if (prevTokenKind !== "dot" && exprDepth === 0) {
        if (CONTROL_FLOW_KEYWORDS.has(word) || word === "for") {
          pendingCondition = true;
          prevTokenKind = "other";
          regexAllowed = false;
          continue;
        }
        if (word === "else" || word === "do") {
          conditionalStmt = true;
          prevTokenKind = "other";
          regexAllowed = true;
          continue;
        }
        if (word === moduleParam) {
          const afterParam = skipWhitespaceAndComments(unwrappedBody, index);
          if (unwrappedBody[afterParam] === ".") {
            const afterDot = skipWhitespaceAndComments(unwrappedBody, afterParam + 1);
            const method = unwrappedBody[afterDot];
            if (method === "S" || method === "s") {
              const afterMethod = skipWhitespaceAndComments(unwrappedBody, afterDot + 1);
              if (unwrappedBody[afterMethod] === "(") {
                const callEnd = scanBalancedEnd(unwrappedBody, afterMethod);
                if (callEnd === -1) return { status: "invalid" };
                const firstArgStart = skipWhitespaceAndComments(unwrappedBody, afterMethod + 1);
                if (unwrappedBody[firstArgStart] !== "[") return { status: "invalid" };
                const arrayEnd = scanBalancedEnd(unwrappedBody, firstArgStart);
                if (arrayEnd === -1 || arrayEnd > callEnd - 1) return { status: "invalid" };
                const afterArray = skipWhitespaceAndComments(unwrappedBody, arrayEnd);
                const targetArg = parseTurbopackTargetModuleArg(unwrappedBody, afterArray, callEnd);
                if (targetArg.status === "invalid") return { status: "invalid" };
                if (targetArg.status === "target" && targetArg.moduleId !== expectedModuleId) {
                  index = callEnd;
                  prevTokenKind = "other";
                  regexAllowed = false;
                  continue;
                }
                const elements = splitTopLevelArrayElements(
                  unwrappedBody.slice(firstArgStart, arrayEnd),
                  0,
                );
                if (!elements) return { status: "invalid" };
                if (method === "S") {
                  let elemIdx = 0;
                  while (elemIdx < elements.length) {
                    const head = elements[elemIdx]!.trim();
                    elemIdx += 1;
                    const groupEntries: string[] = [];
                    while (elemIdx < elements.length && elements[elemIdx]!.trim() !== "0") {
                      groupEntries.push(elements[elemIdx]!.trim());
                      elemIdx += 1;
                    }
                    if (elemIdx < elements.length && elements[elemIdx]!.trim() === "0") {
                      elemIdx += 1;
                    }
                    if (groupEntries.length === 0) return { status: "invalid" };
                    const pairs: Array<[string, string]> = [];
                    if (groupEntries.length === 1) {
                      const joined = parseJsStringLiteral(groupEntries[0]!);
                      if (joined === undefined) return { status: "invalid" };
                      const parts = joined.split(",");
                      if (parts.length < 2 || parts.length % 2 !== 0) return { status: "invalid" };
                      for (let p = 0; p < parts.length; p += 2) {
                        pairs.push([parts[p]!, parts[p + 1]!]);
                      }
                    } else {
                      if (groupEntries.length % 2 !== 0) return { status: "invalid" };
                      for (let p = 0; p < groupEntries.length; p += 2) {
                        const expName = parseJsStringLiteral(groupEntries[p]!);
                        const impName = parseJsStringLiteral(groupEntries[p + 1]!);
                        if (expName === undefined || impName === undefined) {
                          return { status: "invalid" };
                        }
                        pairs.push([expName, impName]);
                      }
                    }
                    const relevantPairs = pairs.filter(([expName]) => expName === wantedExportName);
                    if (relevantPairs.length > 0) {
                      if (
                        conditionalStmt ||
                        relevantPairs.length > 1 ||
                        forwarded !== undefined ||
                        directExportFound
                      ) {
                        return { status: "invalid" };
                      }
                      const targetModuleId =
                        normalizeTurbopackModuleId(head) ??
                        (/^[A-Za-z_$][\w$]*$/u.test(head)
                          ? resolveUniqueTopLevelImportSource(unwrappedBody, head, moduleParam)
                          : undefined);
                      if (!targetModuleId) return { status: "invalid" };
                      forwarded = { targetModuleId, exportName: relevantPairs[0]![1], kind };
                    }
                  }
                } else {
                  const bindings = parseTurbopackEsmExportBindings(elements);
                  if (!bindings) return { status: "invalid" };
                  for (const binding of bindings) {
                    if (binding.name !== wantedExportName) continue;
                    if (conditionalStmt || forwarded !== undefined || directExportFound) {
                      return { status: "invalid" };
                    }
                    const expr =
                      binding.kind === "value"
                        ? stripOuterParens(binding.expr)
                        : unwrapExportGetterBody(binding.getterExpr);
                    const hasSetter = binding.kind === "getter" && binding.setterExpr !== undefined;
                    // 1. Direct namespace re-export getter: `() => ns.prop` or `() => ns["prop"]`
                    if (!hasSetter && expr) {
                      const member = parseCalleeMemberAccess(expr);
                      const targetModuleId = member
                        ? resolveUniqueTopLevelImportSource(unwrappedBody, member.ns, moduleParam)
                        : undefined;
                      if (member && targetModuleId) {
                        forwarded = { targetModuleId, exportName: member.prop, kind };
                        continue;
                      }
                    }
                    // 2. Module-fragment property extractor:
                    //    `const c = b.j.routeModule; a.s(["l", () => c, a => c = a])`
                    //    or `const c = a.i(71829).j.routeModule; a.s(["l", () => c, a => c = a])`
                    if (kind === "route-module-property" && expr) {
                      if (!hasSetter) {
                        const directChain = parseRouteModuleMemberChain(
                          expr,
                          unwrappedBody,
                          moduleParam,
                        );
                        if (directChain) {
                          forwarded = {
                            targetModuleId: directChain.targetModuleId,
                            exportName: directChain.exportName,
                            kind: "entrypoint-object",
                          };
                          continue;
                        }
                      }
                      if (/^[A-Za-z_$][\w$]*$/u.test(expr)) {
                        const setterValid =
                          !hasSetter ||
                          isSimpleSetterForIdentifier(
                            (binding as { setterExpr: string }).setterExpr,
                            expr,
                          );
                        if (setterValid) {
                          const extracted = resolveUniqueRouteModuleLocal(
                            unwrappedBody,
                            expr,
                            moduleParam,
                            hasSetter,
                            [wordStart, callEnd],
                          );
                          if (extracted) {
                            forwarded = {
                              targetModuleId: extracted.targetModuleId,
                              exportName: extracted.exportName,
                              kind: "entrypoint-object",
                            };
                            continue;
                          }
                        }
                      }
                    }
                    directExportFound = true;
                  }
                }
                index = callEnd;
                prevTokenKind = "other";
                regexAllowed = false;
                continue;
              }
            }
          }
        }
      }
      prevTokenKind = "other";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < unwrappedBody.length && /[\w.]/u.test(unwrappedBody[index] ?? "")) index += 1;
      prevTokenKind = "other";
      regexAllowed = false;
      continue;
    }
    if (
      (ch === "+" && unwrappedBody[index + 1] === "+") ||
      (ch === "-" && unwrappedBody[index + 1] === "-")
    ) {
      index += 2;
      prevTokenKind = "other";
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  if (forwarded === undefined) return { status: "terminal" };
  if (hasNestedExportCall || directExportFound) return { status: "invalid" };
  return {
    status: "forward",
    targetModuleId: forwarded.targetModuleId,
    exportName: forwarded.exportName,
    kind: forwarded.kind,
  };
}

type ResolvedTurbopackRouteModuleTarget = {
  moduleId: string;
  exportName: string;
  kind: TurbopackRouteModuleTargetKind;
  forwarded: boolean;
};

function resolveTurbopackRouteModuleTarget(
  entryModuleId: string,
  resolveModule: TurbopackModuleResolver,
): ResolvedTurbopackRouteModuleTarget | undefined {
  let currentModuleId = entryModuleId;
  let currentExportName = "routeModule";
  let kind: TurbopackRouteModuleTargetKind = "route-module-property";
  let forwarded = false;
  const visited = new Set<string>([`${kind}:${entryModuleId}:${currentExportName}`]);

  for (let depth = 0; depth <= 8; depth += 1) {
    const factory = resolveModule(currentModuleId);
    // Ambiguous module IDs (conflicting factories across or within loaded chunks)
    // must fail closed rather than letting the template chunk alone win.
    if (factory === null) return;
    if (factory === undefined) {
      return forwarded
        ? undefined
        : { moduleId: currentModuleId, exportName: currentExportName, kind, forwarded };
    }
    const parsed = parseTurbopackFactory(factory);
    if (!parsed) {
      return { moduleId: currentModuleId, exportName: currentExportName, kind, forwarded };
    }
    const step = inspectTurbopackExportHop(
      parsed.body,
      parsed.param,
      currentModuleId,
      currentExportName,
      kind,
    );
    if (step.status === "invalid") return;
    if (step.status === "terminal") {
      return { moduleId: currentModuleId, exportName: currentExportName, kind, forwarded };
    }
    const visitKey = `${step.kind}:${step.targetModuleId}:${step.exportName}`;
    if (depth === 8 || visited.has(visitKey)) return;
    visited.add(visitKey);
    currentModuleId = step.targetModuleId;
    currentExportName = step.exportName;
    kind = step.kind;
    forwarded = true;
  }
  return;
}

type ExpectedRouteModuleExportTarget = {
  kind: TurbopackRouteModuleTargetKind;
  exportName: string;
};

const DEFAULT_ROUTE_MODULE_EXPORT_TARGET: ExpectedRouteModuleExportTarget = {
  kind: "route-module-property",
  exportName: "routeModule",
};

function verifyEntrypointExportsInScope(
  scopeSource: string,
  entrypointVar: string,
  varStart: number,
  entrypointDeclKind: "let" | "const" | "var",
  moduleParam: string | undefined,
  expectedModuleId: string | undefined,
  expectedTarget: ExpectedRouteModuleExportTarget = DEFAULT_ROUTE_MODULE_EXPORT_TARGET,
): boolean {
  let exportedExpr: string | undefined;
  let exportedViaSetter = false;
  const aliases = new Map<
    string,
    { prop: EntrypointExportName; declStart: number; isConst: boolean }
  >();
  const exportReadSpans: Array<[number, number]> = [];
  const turbopackExportBindings: Array<{
    span: [number, number];
    bindings: TurbopackEsmBinding[];
  }> = [];

  let declKind: "let" | "const" | "var" | undefined;
  let exportDecl = false;
  let exprDepth = 0;
  let pendingCondition = false;
  let conditionalStmt = false;
  let prevTokenKind: "decl" | "comma" | "dot" | "other" = "other";
  let prevWord = "";
  let prevNonWsChar = "";
  let regexAllowed = true;
  let index = 0;

  while (index < scopeSource.length) {
    const ch = scopeSource[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (scopeSource[index + 1] === "/" || scopeSource[index + 1] === "*")) {
      index = skipWhitespaceAndComments(scopeSource, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "`";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(scopeSource, index);
      if (end !== -1) {
        index = end;
        prevTokenKind = "other";
        prevWord = "";
        prevNonWsChar = "/";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "{") {
      const end = scanBalancedEnd(scopeSource, index);
      if (end === -1) return false;
      index = end;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "}";
      conditionalStmt = false;
      pendingCondition = false;
      regexAllowed = true;
      continue;
    }
    if (ch === "(" || ch === "[") {
      exprDepth += 1;
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = true;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (exprDepth > 0) exprDepth -= 1;
      let closedCondition = false;
      if (ch === ")" && exprDepth === 0 && pendingCondition) {
        pendingCondition = false;
        conditionalStmt = true;
        closedCondition = true;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      regexAllowed = closedCondition;
      continue;
    }
    if (ch === ";") {
      if (exprDepth === 0) {
        declKind = undefined;
        exportDecl = false;
        conditionalStmt = false;
        pendingCondition = false;
      }
      index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ";";
      regexAllowed = true;
      continue;
    }
    if (ch === ",") {
      index += 1;
      prevTokenKind = "comma";
      prevWord = "";
      prevNonWsChar = ",";
      regexAllowed = true;
      continue;
    }
    if (ch === ".") {
      if (scopeSource[index + 1] === "." && scopeSource[index + 2] === ".") {
        index += 3;
        prevTokenKind = "other";
        prevWord = "";
        prevNonWsChar = ".";
        regexAllowed = true;
        continue;
      }
      index += 1;
      prevTokenKind = "dot";
      prevWord = "";
      prevNonWsChar = ".";
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < scopeSource.length && /[\w$]/u.test(scopeSource[index] ?? "")) index += 1;
      const word = scopeSource.slice(wordStart, index);

      if (prevTokenKind !== "dot" && exprDepth === 0) {
        // Turbopack module export call: `<moduleParam>.s([...], <moduleId>?, <dynamic>?)`
        if (moduleParam !== undefined && !conditionalStmt && word === moduleParam) {
          const afterParam = skipWhitespaceAndComments(scopeSource, index);
          if (scopeSource[afterParam] === ".") {
            const afterDot = skipWhitespaceAndComments(scopeSource, afterParam + 1);
            if (scopeSource[afterDot] === "s") {
              const afterS = skipWhitespaceAndComments(scopeSource, afterDot + 1);
              if (scopeSource[afterS] === "(") {
                const callEnd = scanBalancedEnd(scopeSource, afterS);
                if (callEnd === -1) return false;
                const firstArgStart = skipWhitespaceAndComments(scopeSource, afterS + 1);
                if (scopeSource[firstArgStart] !== "[") return false;
                const arrayEnd = scanBalancedEnd(scopeSource, firstArgStart);
                if (arrayEnd === -1 || arrayEnd > callEnd - 1) return false;
                const afterArray = skipWhitespaceAndComments(scopeSource, arrayEnd);
                const targetArg = parseTurbopackTargetModuleArg(scopeSource, afterArray, callEnd);
                if (targetArg.status === "invalid") return false;
                if (
                  targetArg.status === "target" &&
                  expectedModuleId !== undefined &&
                  targetArg.moduleId !== expectedModuleId
                ) {
                  index = callEnd;
                  prevTokenKind = "other";
                  prevWord = "";
                  prevNonWsChar = ")";
                  regexAllowed = false;
                  continue;
                }
                const elements = splitTopLevelArrayElements(
                  scopeSource.slice(firstArgStart, arrayEnd),
                  0,
                );
                if (!elements) return false;
                const bindings = parseTurbopackEsmExportBindings(elements);
                if (!bindings) return false;
                for (const binding of bindings) {
                  if (binding.name !== expectedTarget.exportName) continue;
                  if (exportedExpr !== undefined) return false;
                  if (binding.kind === "value") {
                    const expr = stripOuterParens(binding.expr).replace(/\s+/gu, "");
                    if (!expr) return false;
                    exportedExpr = expr;
                  } else {
                    const expr = unwrapExportGetter(binding.getterExpr);
                    if (!expr) return false;
                    if (binding.setterExpr !== undefined) {
                      if (!isSimpleSetterForIdentifier(binding.setterExpr, expr)) return false;
                      exportedViaSetter = true;
                    }
                    exportedExpr = expr;
                  }
                }
                turbopackExportBindings.push({ span: [afterS, callEnd], bindings });
                index = callEnd;
                prevTokenKind = "other";
                prevWord = "";
                prevNonWsChar = ")";
                regexAllowed = false;
                continue;
              }
            }
          }
        }

        // ESM `export ...`
        if (moduleParam === undefined && word === "export") {
          const afterExport = skipWhitespaceAndComments(scopeSource, index);
          if (scopeSource[afterExport] === "{") {
            const braceEnd = scanBalancedEnd(scopeSource, afterExport);
            if (braceEnd === -1) return false;
            const afterBrace = skipWhitespaceAndComments(scopeSource, braceEnd);
            if (!scopeSource.slice(afterBrace).startsWith("from")) {
              const specs = scopeSource.slice(afterExport + 1, braceEnd - 1).split(",");
              for (const rawSpec of specs) {
                const spec = rawSpec.trim();
                if (!spec) continue;
                const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(spec);
                const local = asMatch ? asMatch[1]! : spec;
                const expName = asMatch ? asMatch[2]! : spec;
                if (expName === expectedTarget.exportName) {
                  if (!/^[A-Za-z_$][\w$]*$/u.test(local) || exportedExpr !== undefined) {
                    return false;
                  }
                  exportedExpr = local;
                }
              }
              exportReadSpans.push([afterExport, braceEnd]);
            }
            index = braceEnd;
            prevTokenKind = "other";
            prevWord = "";
            prevNonWsChar = "}";
            regexAllowed = false;
            continue;
          }
          exportDecl = true;
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }

        // CJS `_export(exports, { ... })`
        if (moduleParam === undefined && word === "_export") {
          const afterFn = skipWhitespaceAndComments(scopeSource, index);
          if (scopeSource[afterFn] === "(") {
            const callEnd = scanBalancedEnd(scopeSource, afterFn);
            if (callEnd === -1) return false;
            const args = scopeSource.slice(afterFn + 1, callEnd - 1);
            const commaIdx = args.indexOf(",");
            if (commaIdx !== -1 && args.slice(0, commaIdx).trim() === "exports") {
              const objExpr = args.slice(commaIdx + 1).trim();
              const props = parseTopLevelObjectProperties(objExpr);
              if (!props) return false;
              for (const [key, value] of props) {
                if (key === expectedTarget.exportName) {
                  const unwrapped = unwrapExportGetter(value);
                  if (!unwrapped || exportedExpr !== undefined) return false;
                  exportedExpr = unwrapped;
                }
              }
              exportReadSpans.push([afterFn, callEnd]);
              index = callEnd;
              prevTokenKind = "other";
              prevWord = "";
              prevNonWsChar = ")";
              regexAllowed = false;
              continue;
            }
          }
        }

        // CJS `exports.<prop> = <expr>`
        if (moduleParam === undefined && word === "exports") {
          const afterExp = skipWhitespaceAndComments(scopeSource, index);
          if (scopeSource[afterExp] === ".") {
            const propStart = skipWhitespaceAndComments(scopeSource, afterExp + 1);
            const propMatch =
              /^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)/u.exec(
                scopeSource.slice(propStart),
              );
            if (propMatch && propMatch[1] === expectedTarget.exportName) {
              const rhsEnd = propStart + propMatch[0].length;
              if (!endsInitializerAt(scopeSource, rhsEnd) || exportedExpr !== undefined) {
                return false;
              }
              exportedExpr = propMatch[2]!.replace(/\s+/gu, "");
              exportReadSpans.push([propStart, rhsEnd]);
              index = rhsEnd;
              prevTokenKind = "other";
              prevWord = "";
              prevNonWsChar = propMatch[2]!.at(-1) ?? "";
              regexAllowed = false;
              continue;
            }
          }
        }

        // Reject top-level `module.exports = ...` overwrite in CJS/ESM modules.
        if (moduleParam === undefined && word === "module") {
          const afterMod = skipWhitespaceAndComments(scopeSource, index);
          if (/^\.\s*exports\s*=(?!=)/u.test(scopeSource.slice(afterMod))) return false;
        }

        if (word === "let" || word === "const" || word === "var") {
          declKind = word;
          prevTokenKind = "decl";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (CONTROL_FLOW_KEYWORDS.has(word) || word === "for") {
          pendingCondition = true;
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = false;
          continue;
        }
        if (word === "else" || word === "do") {
          conditionalStmt = true;
          prevTokenKind = "other";
          prevWord = word;
          prevNonWsChar = word.at(-1) ?? "";
          regexAllowed = true;
          continue;
        }

        const isDeclarator =
          !conditionalStmt &&
          (prevTokenKind === "decl" || (prevTokenKind === "comma" && declKind !== undefined));
        if (isDeclarator && word !== entrypointVar) {
          const afterWord = skipWhitespaceAndComments(scopeSource, index);
          if (
            scopeSource[afterWord] === "=" &&
            scopeSource[afterWord + 1] !== "=" &&
            scopeSource[afterWord + 1] !== ">"
          ) {
            const rhsStart = skipWhitespaceAndComments(scopeSource, afterWord + 1);
            const memberMatch = new RegExp(
              `^${escapeRegExpLiteral(entrypointVar)}\\s*\\.\\s*(__next_app__|routeModule|handler)(?![\\w$])`,
              "u",
            ).exec(scopeSource.slice(rhsStart));
            if (memberMatch) {
              const rhsEnd = rhsStart + memberMatch[0].length;
              if (endsInitializerAt(scopeSource, rhsEnd)) {
                const prop = memberMatch[1] as EntrypointExportName;
                if (aliases.has(word)) return false;
                aliases.set(word, { prop, declStart: wordStart, isConst: declKind === "const" });
                if (exportDecl && word === expectedTarget.exportName) {
                  if (exportedExpr !== undefined) return false;
                  exportedExpr = `${entrypointVar}.${prop}`;
                }
                index = rhsEnd;
                prevTokenKind = "other";
                prevWord = prop;
                prevNonWsChar = prop.at(-1) ?? "";
                regexAllowed = false;
                continue;
              }
            } else if (exportDecl && word === expectedTarget.exportName) {
              // Exporting the routeModule name from a non-entrypoint expression.
              return false;
            }
          }
        }
      }

      prevTokenKind = "other";
      prevWord = word;
      prevNonWsChar = word.at(-1) ?? "";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < scopeSource.length && /[\w.]/u.test(scopeSource[index] ?? "")) index += 1;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = "0";
      regexAllowed = false;
      continue;
    }
    if (
      (ch === "+" && scopeSource[index + 1] === "+") ||
      (ch === "-" && scopeSource[index + 1] === "-")
    ) {
      index += 2;
      prevTokenKind = "other";
      prevWord = "";
      prevNonWsChar = ch;
      continue;
    }
    index += 1;
    prevTokenKind = "other";
    prevWord = "";
    prevNonWsChar = ch ?? "";
    regexAllowed = "=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  // Verify the compiled `routeModule` export (or the entrypoint object whose
  // `.routeModule` property is extracted by a downstream Turbopack fragment)
  // comes directly from `entrypointVar` or its immutable alias.
  if (!exportedExpr) return false;
  let routeModuleAlias: { name: string; declStart: number; isConst: boolean } | undefined;
  if (expectedTarget.kind === "entrypoint-object") {
    if (exportedExpr !== entrypointVar) return false;
    if (exportedViaSetter && entrypointDeclKind !== "const") return false;
  } else if (exportedExpr !== `${entrypointVar}.routeModule`) {
    const aliasInfo = aliases.get(exportedExpr);
    if (!aliasInfo || aliasInfo.prop !== "routeModule") return false;
    if (exportedViaSetter && !aliasInfo.isConst) return false;
    routeModuleAlias = {
      name: exportedExpr,
      declStart: aliasInfo.declStart,
      isConst: aliasInfo.isConst,
    };
  }

  // Verify across the entire scope (including nested blocks/templates) that
  // neither `entrypointVar` nor the exported `routeModule` alias is reassigned,
  // redeclared, mutated, or aliased elsewhere.
  const watchedIdents = new Set([entrypointVar]);
  if (routeModuleAlias) watchedIdents.add(routeModuleAlias.name);
  const watchedPattern = new RegExp(
    `(?:(?<![\\w$.])|\\.\\.\\.)(?:${[...watchedIdents].map(escapeRegExpLiteral).join("|")})(?![\\w$])`,
    "u",
  );
  // Only treat a Turbopack `ctx.s([...])` call as an allowed read span when
  // every binding in that call mentioning a watched identifier is a clean read
  // (plus an optional simple setter on a `const` binding).
  for (const { span, bindings } of turbopackExportBindings) {
    const allClean = bindings.every((binding) => {
      const mentionsWatched =
        binding.kind === "value"
          ? watchedPattern.test(binding.expr)
          : watchedPattern.test(binding.getterExpr) ||
            (binding.setterExpr !== undefined && watchedPattern.test(binding.setterExpr));
      if (!mentionsWatched) return true;
      const expr =
        binding.kind === "value"
          ? stripOuterParens(binding.expr).replace(/\s+/gu, "")
          : unwrapExportGetter(binding.getterExpr);
      if (!expr) return false;
      const isAllowedExpr =
        (expectedTarget.kind === "entrypoint-object" && expr === entrypointVar) ||
        expr === `${entrypointVar}.__next_app__` ||
        expr === `${entrypointVar}.routeModule` ||
        expr === `${entrypointVar}.handler` ||
        (routeModuleAlias !== undefined && expr === routeModuleAlias.name);
      if (!isAllowedExpr) return false;
      if (binding.kind === "getter" && binding.setterExpr !== undefined) {
        const isConstTarget =
          (expr === entrypointVar && entrypointDeclKind === "const") ||
          (routeModuleAlias !== undefined &&
            expr === routeModuleAlias.name &&
            routeModuleAlias.isConst);
        return isConstTarget && isSimpleSetterForIdentifier(binding.setterExpr, expr);
      }
      return true;
    });
    if (allClean) exportReadSpans.push(span);
  }
  const inExportReadSpan = (offset: number) =>
    exportReadSpans.some(([start, end]) => offset >= start && offset < end);

  let scanPrevToken: "dot" | "other" = "other";
  let scanPrevWord = "";
  let scanPrevChar = "";
  let scanRegexAllowed = true;
  let scanIdx = 0;

  while (scanIdx < scopeSource.length) {
    const ch = scopeSource[scanIdx];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      scanIdx += 1;
      continue;
    }
    if (ch === "/" && (scopeSource[scanIdx + 1] === "/" || scopeSource[scanIdx + 1] === "*")) {
      scanIdx = skipWhitespaceAndComments(scopeSource, scanIdx);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(scopeSource, scanIdx);
      if (end === -1) return false;
      scanIdx = end;
      scanPrevToken = "other";
      scanPrevWord = "";
      scanPrevChar = ch;
      scanRegexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(scopeSource, scanIdx);
      if (end === -1) return false;
      const literal = scopeSource.slice(scanIdx, end);
      if (literal.includes("${") && watchedPattern.test(literal)) return false;
      scanIdx = end;
      scanPrevToken = "other";
      scanPrevWord = "";
      scanPrevChar = "`";
      scanRegexAllowed = false;
      continue;
    }
    if (ch === "/" && scanRegexAllowed) {
      const end = scanRegexLiteralEnd(scopeSource, scanIdx);
      if (end !== -1) {
        scanIdx = end;
        scanPrevToken = "other";
        scanPrevWord = "";
        scanPrevChar = "/";
        scanRegexAllowed = false;
        continue;
      }
    }
    if (ch === ".") {
      if (scopeSource[scanIdx + 1] === "." && scopeSource[scanIdx + 2] === ".") {
        scanIdx += 3;
        scanPrevToken = "other";
        scanPrevWord = "";
        scanPrevChar = ".";
        scanRegexAllowed = true;
        continue;
      }
      scanIdx += 1;
      scanPrevToken = "dot";
      scanPrevWord = "";
      scanPrevChar = ".";
      scanRegexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = scanIdx;
      scanIdx += 1;
      while (scanIdx < scopeSource.length && /[\w$]/u.test(scopeSource[scanIdx] ?? "")) {
        scanIdx += 1;
      }
      const word = scopeSource.slice(wordStart, scanIdx);
      if (scanPrevToken !== "dot" && watchedIdents.has(word)) {
        const afterWord = skipWhitespaceAndComments(scopeSource, scanIdx);
        const isObjectKey =
          (scanPrevChar === "{" || scanPrevChar === ",") && scopeSource[afterWord] === ":";
        if (!isObjectKey) {
          if (word === entrypointVar) {
            if (
              wordStart !== varStart &&
              !(expectedTarget.kind === "entrypoint-object" && inExportReadSpan(wordStart))
            ) {
              if (scanPrevWord === "delete" || scanPrevChar === "+" || scanPrevChar === "-") {
                return false;
              }
              if (scopeSource[afterWord] !== ".") return false;
              const propStart = skipWhitespaceAndComments(scopeSource, afterWord + 1);
              const propMatch = /^(__next_app__|routeModule|handler)(?![\w$])/u.exec(
                scopeSource.slice(propStart),
              );
              if (!propMatch) return false;
              const afterProp = skipWhitespaceAndComments(
                scopeSource,
                propStart + propMatch[0].length,
              );
              if (isAssignmentOperatorAt(scopeSource, afterProp)) return false;
            }
          } else if (routeModuleAlias !== undefined && word === routeModuleAlias.name) {
            if (wordStart !== routeModuleAlias.declStart && !inExportReadSpan(wordStart)) {
              return false;
            }
            if (
              wordStart !== routeModuleAlias.declStart &&
              !routeModuleAlias.isConst &&
              isAssignmentOperatorAt(scopeSource, afterWord)
            ) {
              return false;
            }
          }
        }
      }
      scanPrevToken = "other";
      scanPrevWord = word;
      scanPrevChar = word.at(-1) ?? "";
      scanRegexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      scanIdx += 1;
      while (scanIdx < scopeSource.length && /[\w.]/u.test(scopeSource[scanIdx] ?? "")) {
        scanIdx += 1;
      }
      scanPrevToken = "other";
      scanPrevWord = "";
      scanPrevChar = "0";
      scanRegexAllowed = false;
      continue;
    }
    if (
      (ch === "+" && scopeSource[scanIdx + 1] === "+") ||
      (ch === "-" && scopeSource[scanIdx + 1] === "-")
    ) {
      scanIdx += 2;
      scanPrevToken = "other";
      scanPrevWord = "";
      scanPrevChar = ch;
      continue;
    }
    scanIdx += 1;
    scanPrevToken = "other";
    scanPrevWord = "";
    scanPrevChar = ch ?? "";
    scanRegexAllowed = "([{=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  return true;
}

function findTreeExpressionsInSource(
  source: string,
  expectedPage: string,
  expectedModuleId: string | undefined,
  expectedTarget: ExpectedRouteModuleExportTarget,
  resolveTurbopackModule: TurbopackModuleResolver,
): Array<string | undefined> {
  const matches: Array<string | undefined> = [];
  let prevNonWsChar = "";
  let prevBeforeParenChar = "";
  let lastOpenParen = -1;
  let regexAllowed = true;
  let index = 0;

  while (index < source.length) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return [];
      index = end;
      prevNonWsChar = ch;
      regexAllowed = false;
      continue;
    }
    if (ch === "`") {
      const end = scanTemplateLiteralEnd(source, index);
      if (end === -1) return [];
      index = end;
      prevNonWsChar = "`";
      regexAllowed = false;
      continue;
    }
    if (ch === "/" && regexAllowed) {
      const end = scanRegexLiteralEnd(source, index);
      if (end !== -1) {
        index = end;
        prevNonWsChar = "/";
        regexAllowed = false;
        continue;
      }
    }
    if (ch === "(") {
      prevBeforeParenChar = prevNonWsChar;
      prevNonWsChar = "(";
      lastOpenParen = index;
      regexAllowed = true;
      index += 1;
      continue;
    }
    if (ch === "{" && prevNonWsChar === "(" && /[\w$)\]]/u.test(prevBeforeParenChar)) {
      const objectStart = index;
      const objectEnd = scanBalancedEnd(source, objectStart);
      if (objectEnd !== -1) {
        const afterObject = skipWhitespaceAndComments(source, objectEnd);
        if (source[afterObject] === ")") {
          const props = parseTopLevelObjectProperties(source.slice(objectStart, objectEnd));
          const pageValue = props?.get("page");
          const pathnameValue = props?.get("pathname");
          const isNextAppPageEntrypointArgs =
            props !== undefined &&
            pageValue !== undefined &&
            parseJsStringLiteral(pageValue) === expectedPage &&
            pathnameValue !== undefined &&
            parseJsStringLiteral(pathnameValue) !== undefined &&
            props.has("tree") &&
            props.has("require") &&
            props.has("loadChunk") &&
            props.has("interopDefault");
          if (isNextAppPageEntrypointArgs) {
            const moduleCtx = findEnclosingModuleContext(source, objectStart);
            const hasAmbiguousModuleId =
              moduleCtx?.moduleIds?.some((id) => resolveTurbopackModule(id) === null) === true;
            if (
              moduleCtx &&
              !hasAmbiguousModuleId &&
              (expectedModuleId === undefined ||
                moduleCtx.moduleIds?.includes(expectedModuleId) === true)
            ) {
              const scopeSource = source.slice(moduleCtx.scopeStart, moduleCtx.scopeEnd);
              const callBinding = extractEntrypointCallBinding(
                scopeSource,
                lastOpenParen - moduleCtx.scopeStart,
                afterObject + 1 - moduleCtx.scopeStart,
              );
              if (
                callBinding &&
                verifyCalleeIsNextEntrypoint(
                  scopeSource,
                  callBinding.calleeText,
                  moduleCtx.moduleParam,
                  resolveTurbopackModule,
                ) &&
                verifyEntrypointExportsInScope(
                  scopeSource,
                  callBinding.entrypointVar,
                  callBinding.varStart,
                  callBinding.declKind,
                  moduleCtx.moduleParam,
                  expectedModuleId,
                  expectedTarget,
                )
              ) {
                const treeExpr = props.get("tree")!;
                if (treeExpr.startsWith("[")) {
                  matches.push(treeExpr);
                } else if (/^[A-Za-z_$][\w$]*$/u.test(treeExpr)) {
                  const identWord = new RegExp(
                    `(?:(?<![\\w$.])|\\.\\.\\.)${escapeRegExpLiteral(treeExpr)}(?![\\w$])`,
                    "u",
                  );
                  const referencedInSiblingProp = [...props.entries()].some(
                    ([propKey, propValue]) =>
                      propKey !== "tree" &&
                      propKey !== "page" &&
                      propKey !== "pathname" &&
                      identWord.test(propValue),
                  );
                  matches.push(
                    referencedInSiblingProp
                      ? undefined
                      : resolveIdentifierArrayInScope(
                          source,
                          objectStart,
                          objectEnd,
                          treeExpr,
                          moduleCtx.moduleParam,
                        ),
                  );
                } else {
                  matches.push(undefined);
                }
              }
            }
          }
        }
      }
      index += 1;
      prevNonWsChar = "{";
      regexAllowed = true;
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch ?? "")) {
      const wordStart = index;
      index += 1;
      while (index < source.length && /[\w$]/u.test(source[index] ?? "")) index += 1;
      const word = source.slice(wordStart, index);
      prevNonWsChar = word.at(-1) ?? "";
      regexAllowed = REGEX_PRECEDING_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/u.test(ch ?? "")) {
      index += 1;
      while (index < source.length && /[\w.]/u.test(source[index] ?? "")) index += 1;
      prevNonWsChar = "0";
      regexAllowed = false;
      continue;
    }
    if ((ch === "+" && source[index + 1] === "+") || (ch === "-" && source[index + 1] === "-")) {
      index += 2;
      prevNonWsChar = ch;
      continue;
    }
    index += 1;
    prevNonWsChar = ch ?? "";
    regexAllowed = "([{=,:;!?&|^~+-*/%<>".includes(ch ?? "");
  }

  return matches;
}

function findTreeExpressionForPage(
  source: string,
  expectedPage: string,
  expectedModuleId?: string,
  resolveTurbopackModule: TurbopackModuleResolver = createTurbopackModuleResolver([source]),
): string | undefined {
  const normalizedExpectedModuleId =
    expectedModuleId === undefined ? undefined : normalizeTurbopackModuleId(expectedModuleId);
  if (expectedModuleId !== undefined && normalizedExpectedModuleId === undefined) return;

  let targetModuleId = normalizedExpectedModuleId;
  let expectedTarget: ExpectedRouteModuleExportTarget = DEFAULT_ROUTE_MODULE_EXPORT_TARGET;
  let forwarded = false;
  if (normalizedExpectedModuleId !== undefined) {
    const resolved = resolveTurbopackRouteModuleTarget(
      normalizedExpectedModuleId,
      resolveTurbopackModule,
    );
    if (!resolved) return;
    targetModuleId = resolved.moduleId;
    expectedTarget = { kind: resolved.kind, exportName: resolved.exportName };
    forwarded = resolved.forwarded;
  }

  let matches = findTreeExpressionsInSource(
    source,
    expectedPage,
    targetModuleId,
    expectedTarget,
    resolveTurbopackModule,
  );
  if (matches.length === 0 && forwarded && targetModuleId !== undefined) {
    const forwardedFactory = resolveTurbopackModule(targetModuleId);
    if (typeof forwardedFactory === "string") {
      matches = findTreeExpressionsInSource(
        `module.exports=[${formatNormalizedTurbopackModuleIdLiteral(targetModuleId)},${forwardedFactory}];`,
        expectedPage,
        targetModuleId,
        expectedTarget,
        resolveTurbopackModule,
      );
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Inspects a compiled Next.js page chunk source for the `loaderTree` bound to
 * `expectedPage` and returns whether an optional catch-all `[[...locale]]`
 * segment sits at or above its first `layout`.
 */
export function compiledLoaderTreeHasOptionalRootLocale(
  source: string,
  expectedPage: string,
  expectedModuleId?: string,
  resolveTurbopackModule?: TurbopackModuleResolver,
): boolean | undefined {
  const treeExpr = findTreeExpressionForPage(
    source,
    expectedPage,
    expectedModuleId,
    resolveTurbopackModule,
  );
  if (!treeExpr) return;
  return walkCompiledLoaderTree(treeExpr, 0, false);
}

const TURBOPACK_JS_CHUNK_URL_PATTERN = /\.js(?:\?[^#]*)?(?:#.*)?$/u;

type ParsedTurbopackPageEntry = {
  runtimeVar?: string;
  runtimeFile?: string;
  expectedModuleId?: string;
  loadedChunks: string[];
};

function runtimeSupportsLeadingNestedFactoryTable(
  runtimeFile: string | undefined,
  distDir: string,
  chunkCache?: TurbopackChunkModuleCache,
): boolean {
  if (!runtimeFile) return false;
  let nestedTableCache = chunkCache ? RUNTIME_NESTED_TABLE_CACHE.get(chunkCache) : undefined;
  const cached = nestedTableCache?.get(runtimeFile);
  if (cached !== undefined) return cached;
  if (!existsSync(runtimeFile)) return false;
  let runtimeSource: string;
  try {
    runtimeSource = readFileSync(runtimeFile, "utf8");
  } catch {
    return false;
  }
  const program = parseJsProgram(runtimeSource, distDir);
  if (!program) return false;
  let supportsNested = false;
  walkJsAst(program, undefined, (node) => {
    if (supportsNested) return false;
    if (
      node.type === "FunctionDeclaration" &&
      isAstNode(node.id) &&
      node.id.type === "Identifier" &&
      node.id.name === "installCompressedModuleFactories" &&
      isAstNode(node.body)
    ) {
      // Next 16.4.1's `installCompressedModuleFactories` checks
      // `Array.isArray(chunkModules[...])` to recursively install a leading
      // nested strict-mode factory array; Next 16.4.6 expects a flat array.
      walkJsAst(node.body, node, (inner) => {
        if (supportsNested) return false;
        if (
          inner.type === "CallExpression" &&
          isAstNode(inner.callee) &&
          inner.callee.type === "MemberExpression" &&
          !inner.callee.computed &&
          isAstNode(inner.callee.object) &&
          inner.callee.object.type === "Identifier" &&
          inner.callee.object.name === "Array" &&
          getMemberPropertyName(inner.callee) === "isArray"
        ) {
          supportsNested = true;
          return false;
        }
        return;
      });
      return false;
    }
    return;
  });
  if (chunkCache) {
    if (!nestedTableCache) {
      nestedTableCache = new Map();
      RUNTIME_NESTED_TABLE_CACHE.set(chunkCache, nestedTableCache);
    }
    nestedTableCache.set(runtimeFile, supportsNested);
  }
  return supportsNested;
}

function getMemberPropertyName(node: JsAstNode): string | undefined {
  if (node.type !== "MemberExpression" || !isAstNode(node.property)) return;
  if (node.computed) return getStringLiteralValue(node.property);
  return node.property.type === "Identifier" && typeof node.property.name === "string"
    ? node.property.name
    : undefined;
}

function parseTurbopackPageEntry(
  entrySource: string,
  distDir: string,
  pageEntryPath: string,
): ParsedTurbopackPageEntry | undefined {
  const program = parseJsProgram(entrySource, distDir);
  if (!program || !Array.isArray(program.body)) return;

  let turbopackRequireVar: string | undefined;
  let runtimeFile: string | undefined;
  let lastModuleExportsRhs: JsAstNode | undefined;
  const topLevelExportsAssignments = new Set<JsAstNode>();

  for (const stmt of program.body as JsAstNode[]) {
    if (stmt.type === "VariableDeclaration" && Array.isArray(stmt.declarations)) {
      for (const decl of stmt.declarations as JsAstNode[]) {
        if (!isAstNode(decl.id) || decl.id.type !== "Identifier" || !isAstNode(decl.init)) continue;
        // Match `var R = require("...turbopack...")(...)` or `var R = require("...turbopack...")`.
        let reqCall: JsAstNode | undefined;
        if (decl.init.type === "CallExpression") {
          if (isAstNode(decl.init.callee) && decl.init.callee.type === "Identifier") {
            reqCall = decl.init;
          } else if (isAstNode(decl.init.callee) && decl.init.callee.type === "CallExpression") {
            reqCall = decl.init.callee;
          }
        }
        if (
          reqCall &&
          isAstNode(reqCall.callee) &&
          reqCall.callee.type === "Identifier" &&
          reqCall.callee.name === "require" &&
          Array.isArray(reqCall.arguments) &&
          reqCall.arguments.length >= 1 &&
          isAstNode(reqCall.arguments[0])
        ) {
          const specifier = getStringLiteralValue(reqCall.arguments[0]);
          if (specifier && specifier.includes("turbopack")) {
            turbopackRequireVar = decl.id.name as string;
            const candidateRuntime = path.resolve(path.dirname(pageEntryPath), specifier);
            const relFromDist = path.relative(distDir, candidateRuntime);
            if (
              relFromDist &&
              relFromDist !== ".." &&
              !relFromDist.startsWith(`..${path.sep}`) &&
              !path.isAbsolute(relFromDist)
            ) {
              runtimeFile = candidateRuntime;
            }
          }
        }
      }
      continue;
    }
    if (stmt.type !== "ExpressionStatement" || !isAstNode(stmt.expression)) continue;
    const exprs =
      stmt.expression.type === "SequenceExpression" && Array.isArray(stmt.expression.expressions)
        ? (stmt.expression.expressions as JsAstNode[])
        : [stmt.expression];
    for (const expr of exprs) {
      if (
        expr.type === "AssignmentExpression" &&
        expr.operator === "=" &&
        isAstNode(expr.left) &&
        isModuleExportsMember(expr.left) &&
        isAstNode(expr.right)
      ) {
        topLevelExportsAssignments.add(expr);
        lastModuleExportsRhs = expr.right;
      }
    }
  }

  let hasNestedModuleExportsWrite = false;
  walkJsAst(program, undefined, (node) => {
    if (hasNestedModuleExportsWrite) return false;
    if (topLevelExportsAssignments.has(node)) return false;
    if (
      node.type === "AssignmentExpression" &&
      isAstNode(node.left) &&
      isModuleExportsMember(node.left)
    ) {
      hasNestedModuleExportsWrite = true;
      return false;
    }
    return;
  });
  if (hasNestedModuleExportsWrite) return;

  // Check if the live `module.exports = ...` assignment is `<rt>.m(<id>).exports`.
  let exportRuntimeVar: string | undefined;
  let expectedModuleId: string | undefined;
  if (lastModuleExportsRhs && getMemberPropertyName(lastModuleExportsRhs) === "exports") {
    const targetCall = lastModuleExportsRhs.object;
    if (isAstNode(targetCall) && targetCall.type === "CallExpression") {
      const callee = targetCall.callee;
      if (
        isAstNode(callee) &&
        getMemberPropertyName(callee) === "m" &&
        isAstNode(callee.object) &&
        callee.object.type === "Identifier" &&
        typeof callee.object.name === "string"
      ) {
        exportRuntimeVar = callee.object.name;
        const args = targetCall.arguments;
        if (!Array.isArray(args) || args.length !== 1 || !isAstNode(args[0])) return;
        const numId = getNumberLiteralValue(args[0]);
        const strId = getStringLiteralValue(args[0]);
        if (numId !== undefined && numId >= 0) {
          expectedModuleId = String(numId);
        } else if (strId !== undefined) {
          expectedModuleId = JSON.stringify(strId);
        } else {
          return;
        }
      }
    }
  }

  const runtimeVar = exportRuntimeVar ?? turbopackRequireVar;
  if (runtimeVar === undefined) {
    return { loadedChunks: [] };
  }

  const loadedChunks: string[] = [];
  let invalid = false;
  walkJsAst(program, undefined, (node, parent) => {
    if (invalid) return false;
    // Skip inline factory tables (`module.exports = [...]`) so unrelated
    // expressions inside factories cannot collide with `runtimeVar`.
    if (
      node.type === "AssignmentExpression" &&
      isAstNode(node.left) &&
      isModuleExportsMember(node.left) &&
      isAstNode(node.right) &&
      unwrapTurbopackArrayNode(node.right) !== undefined
    ) {
      return false;
    }
    if (node.type !== "MemberExpression") return;
    const obj = node.object;
    const prop = node.property;
    if (!isAstNode(obj) || !isAstNode(prop)) return;
    if (obj.type !== "Identifier" || obj.name !== runtimeVar) return;
    const propStr = node.computed ? getStringLiteralValue(prop) : undefined;
    const isChunkLoadAccess = node.computed
      ? propStr === "c"
      : prop.type === "Identifier" && prop.name === "c";
    if (node.computed && propStr === undefined && getNumberLiteralValue(prop) === undefined) {
      invalid = true;
      return false;
    }
    if (!isChunkLoadAccess) return;
    if (!parent || parent.type !== "CallExpression" || parent.callee !== node) {
      invalid = true;
      return false;
    }
    const args = parent.arguments;
    if (!Array.isArray(args) || args.length !== 1) {
      invalid = true;
      return false;
    }
    const arg = args[0];
    const chunkRel = isAstNode(arg) ? getStringLiteralValue(arg) : undefined;
    if (chunkRel === undefined || !chunkRel || path.isAbsolute(chunkRel)) {
      invalid = true;
      return false;
    }
    const resolvedChunk = path.resolve(distDir, chunkRel);
    const relFromDist = path.relative(distDir, resolvedChunk);
    if (
      !relFromDist ||
      relFromDist === ".." ||
      relFromDist.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relFromDist)
    ) {
      invalid = true;
      return false;
    }
    // Match Turbopack's Node `loadRuntimeChunkPath`: non-JS chunks (such as CSS
    // chunks emitted via `R.c("static/chunks/...css")`) are no-ops at runtime.
    if (!TURBOPACK_JS_CHUNK_URL_PATTERN.test(chunkRel)) {
      return;
    }
    loadedChunks.push(resolvedChunk);
    return;
  });

  if (invalid) return;
  return { runtimeVar, runtimeFile, expectedModuleId, loadedChunks };
}

export function compiledRouteHasOptionalRootLocale(
  distDir: string,
  manifestFile: string,
  chunkCache?: TurbopackChunkModuleCache,
): boolean | undefined {
  const serverAppDir = path.join(distDir, "server", "app");
  const manifestRelativePath = path.relative(serverAppDir, manifestFile).split(path.sep).join("/");
  const routeSegments = manifestRelativePath.split("/").slice(0, -1);
  if (!routeSegments.includes("[[...locale]]")) return false;

  const pageEntry = manifestFile.replace(/_client-reference-manifest\.js$/u, ".js");
  if (pageEntry === manifestFile || !existsSync(pageEntry)) return;
  let entrySource: string;
  try {
    entrySource = readFileSync(pageEntry, "utf8");
  } catch {
    return;
  }

  const expectedPage = `/${manifestRelativePath.replace(/_client-reference-manifest\.js$/u, "")}`;
  const parsedEntry = parseTurbopackPageEntry(entrySource, distDir, pageEntry);
  if (!parsedEntry) return;
  const { runtimeVar, runtimeFile, expectedModuleId, loadedChunks } = parsedEntry;
  const allowLeadingNestedTable = runtimeSupportsLeadingNestedFactoryTable(
    runtimeFile,
    distDir,
    chunkCache,
  );

  // Identify the route entrypoint strictly by the live module ID exported by
  // `page.js` (`module.exports = R.m(<id>).exports`) across its loaded chunks
  // rather than by chunk filename heuristics, which can collide with user route
  // segment names (for example `app/next_dist_build_templates_app-page_store/`).
  if (loadedChunks.length > 0) {
    if (expectedModuleId === undefined) return;
    const normalizedExpectedId = normalizeTurbopackModuleId(expectedModuleId);
    if (!normalizedExpectedId) return;
    const resolveModule = createTurbopackModuleResolver(
      [],
      loadedChunks,
      chunkCache,
      distDir,
      allowLeadingNestedTable,
    );
    const entryFactory = resolveModule(normalizedExpectedId);
    if (typeof entryFactory !== "string") return;
    return compiledLoaderTreeHasOptionalRootLocale(
      `module.exports=[${formatNormalizedTurbopackModuleIdLiteral(normalizedExpectedId)},${entryFactory}];`,
      expectedPage,
      expectedModuleId,
      resolveModule,
    );
  }
  if (runtimeVar !== undefined && expectedModuleId === undefined) return;
  const resolveEntryModule = createTurbopackModuleResolver(
    [entrySource],
    [],
    chunkCache,
    distDir,
    allowLeadingNestedTable,
  );
  return compiledLoaderTreeHasOptionalRootLocale(
    entrySource,
    expectedPage,
    expectedModuleId,
    resolveEntryModule,
  );
}

/*
 * Appended to a client reference manifest. It keeps Next's own JavaScript and
 * replaces every array that names an affected chunk with a non-enumerable
 * getter, so Next's deepFreeze() pass over the evaluated object never reads
 * it and an unbound manifest fails on its first render read instead of
 * serving neutral chunks. It is a function channel: functions survive
 * deepFreeze(), and the VM context has no other access to the host.
 */
export function renderManifestAdapter(
  locales: readonly string[],
  fallback: string,
  variants: Readonly<Record<string, readonly string[]>>,
  options: { optionalRootLocale?: boolean } = {},
): string {
  const optionalRootLocale = Boolean(options.optionalRootLocale);
  return `
${ADAPTER_MARKER}
(function () {
  var locales = ${JSON.stringify(locales)};
  var fallback = ${JSON.stringify(fallback)};
  var variants = ${JSON.stringify(variants)};
  var optionalRootLocale = ${JSON.stringify(optionalRootLocale)};
  var keys = Object.keys(variants);
  var resolve = null;
  var covered = Object.create(null);
  globalThis[${JSON.stringify(CLIENT_CATALOG_BIND_GLOBAL)}] = function (fn) { resolve = fn; };
  function locate(value) {
    if (typeof value !== "string") return null;
    for (var i = 0; i < keys.length; i++) {
      var at = value.indexOf(keys[i]);
      var end = at + keys[i].length;
      if (at !== -1 && (at === 0 || value[at - 1] === "/") && (end === value.length || value[end] === "?")) {
        return { key: keys[i], at: at, end: end };
      }
    }
    return null;
  }
  function table(array, index) {
    return Object.freeze(array.map(function (value) {
      var hit = locate(value);
      if (hit) covered[hit.key] = true;
      return hit ? value.slice(0, hit.at) + variants[hit.key][index] + value.slice(hit.end) : value;
    }));
  }
  function visit(owner) {
    Object.keys(owner).forEach(function (name) {
      var value = owner[name];
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value) || !value.some(locate)) return visit(value);
      var tables = locales.map(function (_, index) { return table(value, index); });
      Object.defineProperty(owner, name, {
        enumerable: false,
        get: function () {
          if (resolve === null) {
            throw new Error("Palamedes client catalog permutations: this process renders without a bound locale resolver, so it cannot select locale chunks. Call bindClientCatalogPermutations() from register() in instrumentation.ts; during next build, the prerender workers need the Palamedes Node preload (experimental.workerThreads is not supported).");
          }
          var index = locales.indexOf(resolve(locales, fallback, optionalRootLocale));
          if (index === -1) throw new Error("Palamedes client catalog permutations: the resolved locale has no chunk permutation.");
          return tables[index];
        },
      });
    });
  }
  visit(globalThis.__RSC_MANIFEST);
  return Object.keys(covered);
})();
`;
}

type LoadableManifest = Record<string, { files?: unknown }>;

/*
 * next/dynamic reads this JSON for SSR resource hints only; the rewritten
 * importer loads the actual variant. A JSON file cannot select per request,
 * so the affected JavaScript hints go and the CSS hints stay.
 */
export function filterLoadableManifest(
  manifest: LoadableManifest,
  affected: ReadonlySet<string>,
): number {
  let removed = 0;
  for (const entry of Object.values(manifest)) {
    if (!Array.isArray(entry.files)) {
      throw new TypeError(
        "Palamedes client catalog permutations: react-loadable-manifest.json changed shape; expected { files: string[] } entries.",
      );
    }
    entry.files = entry.files.filter((file: unknown) => {
      const drop = typeof file === "string" && affected.has(file);
      if (drop) removed += 1;
      return !drop;
    });
  }
  return removed;
}

/*
 * build-manifest.json names the bootstrap scripts (the runtime, polyfills,
 * instrumentation-client). Next writes those URLs from JSON, which cannot
 * select per request, so a translation there has no locale copy to load.
 */
export function assertNoBootstrapChunks(
  buildManifest: string,
  affected: ReadonlySet<string>,
): void {
  const bootstrap = [...affected].filter((key) => buildManifest.includes(`"${key}"`));
  if (bootstrap.length > 0) {
    throw new Error(
      `Palamedes client catalog permutations: translated client code reaches Next's bootstrap scripts (${bootstrap.join(", ")} in build-manifest.json). Keep instrumentation-client and other bootstrap code free of translations.`,
    );
  }
}

/** Fail when an affected chunk has no locale-selectable path. */
export function assertChunkCoverage(
  affected: ReadonlySet<string>,
  covered: ReadonlySet<string>,
): void {
  // An affected chunk that no manifest or importer names has no
  // selection path, which means Next changed where it writes chunk URLs.
  const uncovered = [...affected].filter((key) => !covered.has(key));
  if (uncovered.length > 0) {
    throw new Error(
      `Palamedes client catalog permutations: no client reference manifest or importer chunk names ${uncovered.join(", ")}, so no request could select a locale copy. The installed Next writes chunk URLs somewhere this mode does not know.`,
    );
  }
}

async function findFiles(directory: string, name: string | RegExp): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(
    () => [],
  );
  return entries
    .filter(
      (entry) =>
        entry.isFile() && (typeof name === "string" ? entry.name === name : name.test(entry.name)),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

export type EmitClientCatalogPermutationsOptions = {
  distDir: string;
  projectRoot: string;
  configPath?: string;
  failOnMissing: boolean;
};

export type ClientCatalogPermutationReport = {
  locales: string[];
  /** Neutral chunk path to its variant path per locale, in `locales` order. */
  variants: Record<string, string[]>;
  /** Renders without a known locale use this locale's copies. */
  fallbackLocale: string;
  /** Client reference manifests that received the adapter. */
  manifests: string[];
  /** Hints removed from react-loadable-manifest.json files. */
  removedLoadableHints: number;
  /**
   * Optional `[[...locale]]` routes whose compiled root-layout boundary could
   * not be verified and therefore defaulted to fail-closed route-owned mode.
   */
  inconclusiveOptionalLocaleRoutes: string[];
};

export async function emitClientCatalogPermutations(
  options: EmitClientCatalogPermutationsOptions,
): Promise<ClientCatalogPermutationReport> {
  const { distDir } = options;
  const chunksDir = path.join(distDir, "static", "chunks");
  const toKey = (file: string) => path.relative(distDir, file).split(path.sep).join("/");
  const sources = await readChunks(chunksDir);
  const { sidecars, chunkKeys } = scanMarkers(sources);
  const known = new Set([...sources.keys()].map(toKey));
  const graph: ChunkGraph = new Map(
    [...sources].map(([file, source]) => [
      toKey(file),
      { source, references: chunkReferences(source, known) },
    ]),
  );
  const marked = new Set([...chunkKeys.keys()].map(toKey));
  const affected = affectedChunks(graph, marked);
  assertNoBootstrapChunks(
    await readFile(path.join(distDir, "build-manifest.json"), "utf8"),
    affected,
  );

  const compiler = await createCatalogCompiler(options, sidecars);
  for (const locale of compiler.locales) {
    if (!LOCALE_PATTERN.test(locale)) {
      throw new Error(
        `Palamedes client catalog permutations: locale "${locale}" cannot name a chunk. Use letters, digits, "_" and "-" in locale codes.`,
      );
    }
  }
  const variants: Record<string, string[]> = Object.fromEntries(
    [...affected].sort().map((key) => [key, []]),
  );
  for (const locale of compiler.locales) {
    const compiled = await compiler.compileLocale(locale);
    const expressions = new Map(
      [...compiled].map(([key, messages]) => [key, inlineMessageExpression(messages)]),
    );
    for (const [key, variant] of renderVariants(graph, affected, locale, expressions)) {
      await writeFile(path.join(distDir, variant.path), variant.body);
      variants[key]!.push(variant.path);
    }
  }

  const covered = new Set<string>();
  for (const key of affected) {
    for (const ref of graph.get(key)!.references) if (affected.has(ref)) covered.add(ref);
  }
  let removedLoadableHints = 0;
  for (const file of await findFiles(distDir, "react-loadable-manifest.json")) {
    if (file.includes(`${path.sep}standalone${path.sep}`)) continue;
    const manifest = JSON.parse(await readFile(file, "utf8")) as LoadableManifest;
    // Hints are removed below, so they count for nothing here.
    removedLoadableHints += filterLoadableManifest(manifest, affected);
    await writeFile(file, JSON.stringify(manifest));
  }

  const serverAppDir = path.join(distDir, "server", "app");
  const manifests = await findFiles(serverAppDir, /_client-reference-manifest\.js$/u);
  if (!compiler.locales.includes(compiler.sourceLocale)) {
    throw new Error(
      `Palamedes client catalog permutations: the source locale "${compiler.sourceLocale}" is not in the configured locales, so renders without a locale have no fallback chunk copy.`,
    );
  }
  const standardAdapter = renderManifestAdapter(compiler.locales, compiler.sourceLocale, variants, {
    optionalRootLocale: false,
  });
  const optionalRootLocaleAdapter = renderManifestAdapter(
    compiler.locales,
    compiler.sourceLocale,
    variants,
    { optionalRootLocale: true },
  );
  const turbopackChunkCache: TurbopackChunkModuleCache = new Map();
  const inconclusiveOptionalLocaleRoutes: string[] = [];
  for (const file of manifests) {
    const source = (await readFile(file, "utf8")).split(`\n${ADAPTER_MARKER}`)[0]!;
    // Next may construct paths from shared prefixes, so inspect the evaluated
    // arrays that the adapter actually replaces, not substrings in source.
    // Evaluate coverage first so server-only routes without affected client
    // chunks skip compiled route-tree inspection and avoid spurious warnings.
    let manifestCoverage: unknown;
    try {
      manifestCoverage = vm.runInNewContext(
        `globalThis.process = { env: {} };\n${source}${standardAdapter}`,
        Object.create(null),
        {
          timeout: 1000,
          contextCodeGeneration: { strings: false, wasm: false },
          microtaskMode: "afterEvaluate",
        },
      );
    } catch (error) {
      throw new Error(
        `Palamedes client catalog permutations: could not inspect manifest ${file}.`,
        {
          cause: error,
        },
      );
    }
    if (!Array.isArray(manifestCoverage)) {
      throw new TypeError(
        `Palamedes client catalog permutations: could not inspect manifest ${file}.`,
      );
    }
    let referencesAffectedChunks = false;
    for (const key of manifestCoverage) {
      if (typeof key === "string") {
        covered.add(key);
        referencesAffectedChunks = true;
      }
    }

    const manifestRelativePath = path.relative(serverAppDir, file).split(path.sep).join("/");
    const hasOptionalLocaleSegment = manifestRelativePath
      .split("/")
      .slice(0, -1)
      .includes("[[...locale]]");
    // Rely strictly on the compiled route tree from this build; never read the
    // mutable app/ source directory on disk to authorize header selection. Fail
    // closed (`true`) when an optional `[[...locale]]` route with affected
    // client chunks cannot be verified as having a compiled root layout above
    // `[[...locale]]`, and surface the affected route at build time so
    // header-driven layouts do not silently ship source-locale chunks.
    let optionalRootLocale = false;
    if (referencesAffectedChunks && hasOptionalLocaleSegment) {
      const detected = compiledRouteHasOptionalRootLocale(distDir, file, turbopackChunkCache);
      if (detected === undefined) {
        inconclusiveOptionalLocaleRoutes.push(
          `/${manifestRelativePath.replace(/_client-reference-manifest\.js$/u, "")}`,
        );
        optionalRootLocale = true;
      } else {
        optionalRootLocale = detected;
      }
    }
    const adapter = optionalRootLocale ? optionalRootLocaleAdapter : standardAdapter;
    await writeFile(file, `${source}${adapter}`);
  }
  assertChunkCoverage(affected, covered);
  if (inconclusiveOptionalLocaleRoutes.length > 0) {
    console.warn(
      `Palamedes client catalog permutations: could not verify the compiled root-layout boundary for ${inconclusiveOptionalLocaleRoutes.join(", ")}. Defaulting to fail-closed route-owned locale handling (ignoring x-palamedes-locale when [[...locale]] is omitted). If this route's root layout sits above [[...locale]] and relies on a Proxy header, pass { localeSource: "header", headerSecret } to bindClientCatalogPermutations().`,
    );
  }
  return {
    locales: compiler.locales,
    fallbackLocale: compiler.sourceLocale,
    variants,
    manifests: manifests.map(toKey),
    removedLoadableHints,
    inconclusiveOptionalLocaleRoutes,
  };
}
