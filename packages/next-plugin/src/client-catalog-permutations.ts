import { createHash } from "node:crypto";
import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
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

const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"] as const;

function resolveAppDirectory(projectRoot: string): string | undefined {
  const rootApp = path.join(projectRoot, "app");
  if (existsSync(rootApp)) return rootApp;
  const srcApp = path.join(projectRoot, "src", "app");
  if (existsSync(srcApp)) return srcApp;
  return;
}

function isRegularFileTarget(entryPath: string): boolean {
  try {
    return statSync(entryPath).isFile();
  } catch {
    return false;
  }
}

function isDirectoryTarget(entryPath: string): boolean {
  try {
    return statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function directoryHasLayout(directory: string, extensions: readonly string[]): boolean {
  const expectedNames = new Set(
    extensions
      .map((ext) => (ext.startsWith(".") ? ext.slice(1) : ext))
      .filter((ext) => ext.length > 0)
      .map((ext) => `layout.${ext}`),
  );
  if (expectedNames.size === 0) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) =>
      expectedNames.has(entry.name) &&
      (entry.isFile() ||
        (entry.isSymbolicLink() && isRegularFileTarget(path.join(directory, entry.name)))),
  );
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

function scanBalancedEnd(source: string, start: number): number {
  const open = source[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
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
  const elements: string[] = [];
  let index = arrayStart + 1;
  let elemStart = index;
  while (index < arrayEnd - 1) {
    const ch = source[index];
    if (ch === '"' || ch === "'") {
      const end = scanQuotedStringEnd(source, index);
      if (end === -1) return;
      index = end;
      continue;
    }
    if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === "[" || ch === "{" || ch === "(") {
      const end = scanBalancedEnd(source, index);
      if (end === -1) return;
      index = end;
      continue;
    }
    if (ch === ",") {
      elements.push(source.slice(elemStart, index).trim());
      index += 1;
      elemStart = index;
      continue;
    }
    index += 1;
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
    while (index < objectEnd - 1) {
      const ch = trimmed[index];
      if (ch === '"' || ch === "'") {
        const end = scanQuotedStringEnd(trimmed, index);
        if (end === -1) return;
        index = end;
        continue;
      }
      if (ch === "/" && (trimmed[index + 1] === "/" || trimmed[index + 1] === "*")) {
        index = skipWhitespaceAndComments(trimmed, index);
        continue;
      }
      if (ch === "[" || ch === "{" || ch === "(") {
        const end = scanBalancedEnd(trimmed, index);
        if (end === -1) return;
        index = end;
        continue;
      }
      if (ch === ",") break;
      index += 1;
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
  if (modules.has("layout")) return hasOptionalLocale;
  const childrenExpr = parallelRoutes.get("children");
  if (!childrenExpr || !childrenExpr.startsWith("[")) return false;
  return walkCompiledLoaderTree(childrenExpr, 0, hasOptionalLocale);
}

function findTreeExpressionForPage(source: string, expectedPage: string): string | undefined {
  const pagePropertyPattern = /(?:\bpage|"page"|'page')\s*:\s*(?=["'])/gu;
  const matches: string[] = [];
  for (const match of source.matchAll(pagePropertyPattern)) {
    const quoteStart = match.index + match[0].length;
    const quoteEnd = scanQuotedStringEnd(source, quoteStart);
    if (quoteEnd === -1) continue;
    if (parseJsStringLiteral(source.slice(quoteStart, quoteEnd)) !== expectedPage) continue;
    // Walk backward to the enclosing object literal `{ ... tree: ..., page: "<expectedPage>" ... }`.
    let objectStart = -1;
    let depth = 0;
    let quote: '"' | "'" | undefined;
    for (let index = match.index - 1; index >= 0; index -= 1) {
      const ch = source[index];
      if (quote) {
        if (ch === quote) {
          let backslashes = 0;
          for (let bs = index - 1; bs >= 0 && source[bs] === "\\"; bs -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = undefined;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        if (depth === 0) {
          objectStart = index;
          break;
        }
        depth -= 1;
      }
    }
    if (objectStart === -1) continue;
    const objectEnd = scanBalancedEnd(source, objectStart);
    if (objectEnd === -1 || objectEnd < match.index) continue;
    const props = parseTopLevelObjectProperties(source.slice(objectStart, objectEnd));
    if (!props) continue;
    const pageValue = props.get("page");
    if (!pageValue || parseJsStringLiteral(pageValue) !== expectedPage) continue;
    const treeExpr = props.get("tree");
    if (!treeExpr) continue;
    if (treeExpr.startsWith("[")) {
      matches.push(treeExpr);
      continue;
    }
    if (!/^[A-Za-z_$][\w$]*$/u.test(treeExpr)) continue;
    // Locate the lexical binding `<ident> = [...]` preceding this entrypoint call.
    const prefix = source.slice(0, objectStart);
    const bindingPattern = new RegExp(
      `(?:^|[;,{(\\s])${treeExpr.replaceAll("$", "\\$")}\\s*=\\s*\\[`,
      "gu",
    );
    let lastArrayStart = -1;
    for (const bindingMatch of prefix.matchAll(bindingPattern)) {
      lastArrayStart = bindingMatch.index + bindingMatch[0].length - 1;
    }
    if (lastArrayStart === -1) continue;
    const arrayEnd = scanBalancedEnd(prefix, lastArrayStart);
    if (arrayEnd === -1) continue;
    matches.push(prefix.slice(lastArrayStart, arrayEnd));
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Inspects Next.js's compiled `loaderTree` for a route manifest to determine
 * whether an optional catch-all `[[...locale]]` segment sits at or above the
 * route's first `layout`, matching Next.js's `getRootParamsImpl()`. Uses the
 * compiled route tree bound to this exact page entry so wrapper-supplied
 * `pageExtensions`, `%5F` escaped segments, server-only layouts, and colocated
 * directories all match Next's actual build output.
 */
export function compiledRouteHasOptionalRootLocale(
  distDir: string,
  manifestFile: string,
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
  const chunkPaths: string[] = [];
  for (const match of entrySource.matchAll(/\.c\(\s*["']([^"']+\.js)["']\s*\)/gu)) {
    const chunkRel = match[1];
    if (chunkRel) chunkPaths.push(path.join(distDir, chunkRel));
  }
  // Prioritize Next's app-page template chunk, which carries the route's loaderTree,
  // and read candidate chunks lazily so unrelated bundles are never read.
  chunkPaths.sort((a, b) => {
    const aIsTemplate = a.includes("app-page") ? 0 : 1;
    const bIsTemplate = b.includes("app-page") ? 0 : 1;
    return aIsTemplate - bIsTemplate;
  });

  const inspectSource = (source: string): boolean | undefined => {
    const treeExpr = findTreeExpressionForPage(source, expectedPage);
    if (!treeExpr) return;
    return walkCompiledLoaderTree(treeExpr, 0, false);
  };

  for (const chunkPath of chunkPaths) {
    let chunkSource: string;
    try {
      chunkSource = readFileSync(chunkPath, "utf8");
    } catch {
      continue;
    }
    const result = inspectSource(chunkSource);
    if (result !== undefined) return result;
  }
  return inspectSource(entrySource);
}

function resolveSourceSegmentDirectory(
  parentDir: string,
  emittedSegment: string,
): string | undefined {
  // Next.js treats folders starting with `_` as private non-route folders and
  // decodes `%5F` back to `_` in emitted manifest paths. Never match a private
  // `_` folder when resolving an emitted route segment.
  if (!emittedSegment.startsWith("_")) {
    const direct = path.join(parentDir, emittedSegment);
    if (existsSync(direct)) return direct;
  }
  if (!emittedSegment.includes("_")) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return;
  }
  const match = entries.find(
    (entry) =>
      !entry.name.startsWith("_") &&
      entry.name.replace(/%5F/giu, "_") === emittedSegment &&
      (entry.isDirectory() ||
        (entry.isSymbolicLink() && isDirectoryTarget(path.join(parentDir, entry.name)))),
  );
  return match ? path.join(parentDir, match.name) : undefined;
}

/**
 * Determines from the App Router directory tree whether `manifestRelativePath`
 * (relative to `<distDir>/server/app`) has an optional catch-all
 * `[[...locale]]` segment at or above its root layout — matching Next.js's
 * `getRootParamsImpl()`, which stops at the first `layout` along `children`.
 */
export function routeHasOptionalRootLocale(
  projectRoot: string,
  manifestRelativePath: string,
  pageExtensions: readonly string[] = DEFAULT_PAGE_EXTENSIONS,
): boolean {
  const appDir = resolveAppDirectory(projectRoot);
  if (!appDir) return false;
  const routeDir = path.posix.dirname(manifestRelativePath.replaceAll("\\", "/"));
  if (routeDir === "." || routeDir === "") return false;
  const segments = routeDir.split("/").filter(Boolean);
  const localeIndex = segments.indexOf("[[...locale]]");
  if (localeIndex === -1) return false;

  // Next's `getRootParamsImpl()` traverses only `parallelRoutes.children`, so
  // any parallel-route slot above `[[...locale]]` cannot provide a root param.
  for (let index = 0; index < localeIndex; index += 1) {
    if (segments[index]!.startsWith("@")) return false;
  }

  // If any ancestor directory strictly above `[[...locale]]` defines a layout,
  // that layout is the root layout and `[[...locale]]` is below it.
  let current = appDir;
  if (directoryHasLayout(current, pageExtensions)) return false;
  for (let index = 0; index < localeIndex; index += 1) {
    const nextDir = resolveSourceSegmentDirectory(current, segments[index]!);
    if (!nextDir) return false;
    current = nextDir;
    if (directoryHasLayout(current, pageExtensions)) return false;
  }

  // At least one layout must exist at `[[...locale]]` or a descendant along the
  // route; otherwise Next injects its built-in root layout above the route.
  const localeDir = resolveSourceSegmentDirectory(current, segments[localeIndex]!);
  if (!localeDir) return false;
  current = localeDir;
  if (directoryHasLayout(current, pageExtensions)) return true;
  for (let index = localeIndex + 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.startsWith("@")) return false;
    const nextDir = resolveSourceSegmentDirectory(current, segment);
    if (!nextDir) return false;
    current = nextDir;
    if (directoryHasLayout(current, pageExtensions)) return true;
  }
  return false;
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
  pageExtensions?: readonly string[];
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
  const pageExtensions = options.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS;
  const standardAdapter = renderManifestAdapter(compiler.locales, compiler.sourceLocale, variants, {
    optionalRootLocale: false,
  });
  const optionalRootLocaleAdapter = renderManifestAdapter(
    compiler.locales,
    compiler.sourceLocale,
    variants,
    { optionalRootLocale: true },
  );
  for (const file of manifests) {
    const manifestRelativePath = path.relative(serverAppDir, file).split(path.sep).join("/");
    const hasOptionalLocaleSegment = manifestRelativePath
      .split("/")
      .slice(0, -1)
      .includes("[[...locale]]");
    const optionalRootLocale = hasOptionalLocaleSegment
      ? (compiledRouteHasOptionalRootLocale(distDir, file) ??
        routeHasOptionalRootLocale(options.projectRoot, manifestRelativePath, pageExtensions))
      : false;
    const adapter = optionalRootLocale ? optionalRootLocaleAdapter : standardAdapter;
    const source = (await readFile(file, "utf8")).split(`\n${ADAPTER_MARKER}`)[0]!;
    // Next may construct paths from shared prefixes, so inspect the evaluated
    // arrays that the adapter actually replaces, not substrings in source.
    let manifestCoverage: unknown;
    try {
      manifestCoverage = vm.runInNewContext(
        `globalThis.process = { env: {} };\n${source}${adapter}`,
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
    for (const key of manifestCoverage) if (typeof key === "string") covered.add(key);
    await writeFile(file, `${source}${adapter}`);
  }
  assertChunkCoverage(affected, covered);
  return {
    locales: compiler.locales,
    fallbackLocale: compiler.sourceLocale,
    variants,
    manifests: manifests.map(toKey),
    removedLoadableHints,
  };
}
