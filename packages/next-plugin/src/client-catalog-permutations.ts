import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
): string {
  return `
${ADAPTER_MARKER}
(function () {
  var locales = ${JSON.stringify(locales)};
  var fallback = ${JSON.stringify(fallback)};
  var variants = ${JSON.stringify(variants)};
  var keys = Object.keys(variants);
  var resolve = null;
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
          var index = locales.indexOf(resolve(locales, fallback));
          if (index === -1) throw new Error("Palamedes client catalog permutations: the resolved locale has no chunk permutation.");
          return tables[index];
        },
      });
    });
  }
  visit(globalThis.__RSC_MANIFEST);
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

  const manifests = await findFiles(
    path.join(distDir, "server", "app"),
    /_client-reference-manifest\.js$/u,
  );
  if (!compiler.locales.includes(compiler.sourceLocale)) {
    throw new Error(
      `Palamedes client catalog permutations: the source locale "${compiler.sourceLocale}" is not in the configured locales, so renders without a locale have no fallback chunk copy.`,
    );
  }
  const adapter = renderManifestAdapter(compiler.locales, compiler.sourceLocale, variants);
  for (const file of manifests) {
    const source = (await readFile(file, "utf8")).split(`\n${ADAPTER_MARKER}`)[0]!;
    for (const key of affected) if (source.includes(key)) covered.add(key);
    await writeFile(file, `${source}${adapter}`);
  }
  // An affected chunk that no manifest, importer, or hint names has no
  // selection path, which means Next changed where it writes chunk URLs.
  const uncovered = [...affected].filter((key) => !covered.has(key));
  if (uncovered.length > 0) {
    throw new Error(
      `Palamedes client catalog permutations: no client reference manifest or importer chunk names ${uncovered.join(", ")}, so no request could select a locale copy. The installed Next writes chunk URLs somewhere this mode does not know.`,
    );
  }
  return {
    locales: compiler.locales,
    fallbackLocale: compiler.sourceLocale,
    variants,
    manifests: manifests.map(toKey),
    removedLoadableHints,
  };
}
