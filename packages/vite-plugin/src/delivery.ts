import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parse } from "parse5";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PassThrough, Transform, type TransformCallback } from "node:stream";

const SPLIT_MANIFEST_NAME = "palamedes-split-manifest.json";

export type ViteCatalogManifest = {
  readonly locales: readonly string[];
  readonly importMaps: Readonly<Record<string, string>>;
  readonly chunkImports: Readonly<Record<string, readonly string[]>>;
};

export type ViteCatalogBinding = {
  readonly locale: string;
  readonly importMapJson: string;
  readonly imports: Readonly<Record<string, string>>;
  readonly chunkImports: Readonly<Record<string, readonly string[]>>;
};

export type ViteCatalogDeliveryOptions = {
  /** The host's built Vite client directory, such as React Router's `build/client`. */
  readonly clientDirectory: string;
  /** Use development-generated active-locale dependencies before a client build exists. */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
};

export type ViteDocumentTransformOptions = {
  /** A CSP nonce for the inline import-map element. */
  readonly nonce?: string;
  /** Trusted catalog-independent host error markup; omit for a generic reload/home view. */
  readonly errorHtml?: string;
  /**
   * The document locale. When set, the transform writes it to `<html lang>`,
   * which the generated browser bootstrap reads and checks against the
   * locale-bound catalogs. Hosts pass it when the layout cannot know the
   * request locale for every document, such as a 404 rendered without route data.
   */
  readonly lang?: string;
  /**
   * Further attributes to set on `<html>`, such as a marker the host's browser
   * code reads to render the same markup the server rendered. Names must be
   * plain attribute names; values are escaped.
   */
  readonly htmlAttributes?: Readonly<Record<string, string>>;
};

const HTML_ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/iu;
const MAX_HEAD_BUFFER_LENGTH = 1024 * 1024;
const HEAD_RAW_TAGS = ["script", "style", "title"] as const;

/**
 * Owns the server half of Vite's locale-bound catalog delivery for SSR hosts
 * such as React Router, Waku, Solid, and TanStack Start. Applications select a
 * locale; they do not read manifests or splice import maps and preloads into
 * the document themselves.
 */
export function createViteCatalogDelivery(options: ViteCatalogDeliveryOptions): {
  readManifest(): ViteCatalogManifest | null;
  getLocaleBinding(locale: string): ViteCatalogBinding | null;
  createDocumentTransform(
    binding: ViteCatalogBinding | null,
    transformOptions?: ViteDocumentTransformOptions,
  ): Transform;
} {
  const clientDirectory = path.resolve(options.clientDirectory);
  const manifestName = options.manifestName ?? SPLIT_MANIFEST_NAME;
  let manifestStamp: string | undefined;
  let manifest: ViteCatalogManifest | null | undefined;
  const bindingCache = new Map<string, ViteCatalogBinding>();

  function readManifest(): ViteCatalogManifest | null {
    if (options.development) return null;
    const manifestPath = path.join(clientDirectory, manifestName);
    let stamp: string;
    try {
      const stat = statSync(manifestPath);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch (error) {
      if (options.development && isMissingFile(error)) {
        manifest = null;
        manifestStamp = undefined;
        bindingCache.clear();
        return null;
      }
      throw new Error(
        `Palamedes Vite catalog delivery could not read ${manifestPath}; the Vite client manifest is required before browser modules execute.`,
        { cause: error },
      );
    }
    if (manifest !== undefined && manifestStamp === stamp) {
      return manifest;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`Palamedes Vite catalog delivery could not parse ${manifestPath}.`, {
        cause: error,
      });
    }
    manifest = validateManifest(parsed, manifestPath);
    manifestStamp = stamp;
    bindingCache.clear();
    return manifest;
  }

  function getLocaleBinding(locale: string): ViteCatalogBinding | null {
    const current = readManifest();
    if (!current) return null;
    if (!current.locales.includes(locale)) {
      throw new Error(
        `Palamedes Vite catalog delivery has no generated import map for locale ${JSON.stringify(locale)} in ${path.join(clientDirectory, manifestName)}.`,
      );
    }
    const mapName = Object.hasOwn(current.importMaps, locale)
      ? current.importMaps[locale]
      : undefined;
    if (!mapName) {
      throw new Error(
        `Palamedes Vite catalog delivery manifest ${path.join(clientDirectory, manifestName)} is missing the import map for locale ${JSON.stringify(locale)}.`,
      );
    }
    if (
      path.isAbsolute(mapName) ||
      path.win32.isAbsolute(mapName) ||
      mapName.split(/[\\/]/u).some((part) => part === ".." || part === ".")
    ) {
      throw new Error(
        `Palamedes Vite catalog delivery manifest ${path.join(clientDirectory, manifestName)} has an invalid import-map path for locale ${JSON.stringify(locale)}.`,
      );
    }
    const mapPath = path.resolve(clientDirectory, mapName);
    const relativeMapPath = path.relative(clientDirectory, mapPath);
    if (
      relativeMapPath === "" ||
      relativeMapPath === ".." ||
      relativeMapPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeMapPath)
    ) {
      throw new Error(
        `Palamedes Vite catalog delivery manifest ${path.join(clientDirectory, manifestName)} has an invalid import-map path for locale ${JSON.stringify(locale)}.`,
      );
    }
    const cacheKey = `${manifestStamp}:${locale}:${mapName}`;
    const cached = bindingCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    let importMapJson: string;
    let imports: Record<string, string>;
    try {
      importMapJson = readFileSync(mapPath, "utf8");
      const candidate = JSON.parse(importMapJson) as { imports?: unknown } | null;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        !isStringRecord(candidate.imports)
      ) {
        throw new TypeError("the imports object is missing");
      }
      imports = candidate.imports;
    } catch (error) {
      throw new Error(
        `Palamedes Vite catalog delivery could not read the generated import map for locale ${JSON.stringify(locale)} at ${mapPath}.`,
        { cause: error },
      );
    }
    const binding: ViteCatalogBinding = {
      locale,
      importMapJson,
      imports,
      chunkImports: current.chunkImports,
    };
    bindingCache.set(cacheKey, binding);
    return binding;
  }

  return { readManifest, getLocaleBinding, createDocumentTransform };

  function createDocumentTransform(
    binding: ViteCatalogBinding | null,
    transformOptions: ViteDocumentTransformOptions = {},
  ): Transform {
    for (const name of Object.keys(transformOptions.htmlAttributes ?? {})) {
      if (!HTML_ATTRIBUTE_NAME.test(name)) {
        throw new TypeError(`Invalid <html> attribute name ${JSON.stringify(name)}.`);
      }
    }
    if (!binding && !options.development) return new PassThrough();
    const nonce = transformOptions.nonce
      ? ` nonce="${escapeAttribute(transformOptions.nonce)}"`
      : "";
    const importMap = binding
      ? `<script type="importmap"${nonce}>${escapeScriptData(binding.importMapJson)}</script>`
      : "";
    const decoder = new StringDecoder("utf8");
    const headScanner = createHeadCloseScanner();
    let buffered = "";
    let passthrough = false;
    return new Transform({
      transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
        let output: string | undefined;
        try {
          const text = decodeChunk(decoder, chunk);
          if (passthrough) {
            output = text;
          } else {
            buffered += text;
            const headEnd = headScanner.scan(buffered);
            if (headEnd !== -1 && headEnd <= MAX_HEAD_BUFFER_LENGTH) {
              const head = buffered.slice(0, headEnd);
              const tail = buffered.slice(headEnd);
              // A recovery link must start a new document and module graph, even
              // when a mounted client router still owns delegated click handling.
              const errorHtml =
                transformOptions.errorHtml ??
                '<main role="alert" data-palamedes-catalog-error><h1>This page is temporarily unavailable.</h1><p>Reload the page to try again.</p><a href="" target="_self">Reload page</a> <a href="/" target="_self">Go home</a></main>';
              const preloads = binding ? modulePreloads(head, binding) : [];
              // React Router imports initial routes before executing entry.client.
              // This independent module observes the same dependency promises and can
              // show ordinary host error markup even when that entry never executes.
              // Development sidecars report their own catalog failures. General
              // runtime errors and unrelated imports remain the host's responsibility.
              const probe = binding
                ? `<script${nonce}>globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]=Promise.all(${escapeScriptData(JSON.stringify(preloads))}.map(url=>import(url)));globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")].then(()=>{globalThis[Symbol.for("palamedes.document-catalogs-ready")]=true}).catch(async()=>{if(!document.body)await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));const template=document.createElement("template");template.innerHTML=${escapeScriptData(JSON.stringify(errorHtml))};document.body.replaceChildren(template.content.cloneNode(true));});</script>`
                : `<script${nonce}>const showPalamedesDevCatalogError=()=>{const render=()=>{if(globalThis[Symbol.for("palamedes.dev-catalog-error-rendered")])return;if(!document.body){document.addEventListener("DOMContentLoaded",render,{once:true});return;}globalThis[Symbol.for("palamedes.dev-catalog-error-rendered")]=true;const template=document.createElement("template");template.innerHTML=${escapeScriptData(JSON.stringify(errorHtml))};document.body.replaceChildren(template.content.cloneNode(true));};render();};const handlePalamedesDevCatalogError=()=>{if(globalThis.__reactRouterContext)globalThis.__reactRouterContext.isSpaMode=true;showPalamedesDevCatalogError();};globalThis.addEventListener("palamedes:catalogError",handlePalamedesDevCatalogError);</script>`;
              const links = preloads
                .map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`)
                .join("");
              // The SSR framework may echo Vite's bare catalog preload hints before
              // the locale import map exists. They resolve as `/#pmds/...` and make
              // the browser request HTML as a JavaScript module. Replace them with
              // the locale-bound asset preloads generated above.
              let sanitizedHead = head.replace(
                /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["'][^"']*#pmds\/[^"]+["'][^>]*>\s*/giu,
                "",
              );
              const htmlAttributes = {
                ...transformOptions.htmlAttributes,
                ...(transformOptions.lang === undefined ? {} : { lang: transformOptions.lang }),
              };
              if (Object.keys(htmlAttributes).length > 0) {
                sanitizedHead = setHtmlAttributes(sanitizedHead, htmlAttributes);
              }
              output = `${sanitizedHead.replace(/<head\b[^>]*>/iu, (tag) => `${tag}${importMap}`)}${probe}${links}${tail}`;
              passthrough = true;
              buffered = "";
            } else if (
              headEnd > MAX_HEAD_BUFFER_LENGTH ||
              (buffered.length > MAX_HEAD_BUFFER_LENGTH &&
                !headScanner.hasPendingHeadCloseAtOrBefore(MAX_HEAD_BUFFER_LENGTH))
            ) {
              if (headScanner.sawHeadOpen()) {
                buffered = "";
                throw new Error(
                  `Palamedes Vite catalog delivery exceeded the ${MAX_HEAD_BUFFER_LENGTH}-character <head> buffer limit before </head>.`,
                );
              }
              output = buffered;
              passthrough = true;
              buffered = "";
            }
          }
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (output !== undefined) {
          callback(null, output);
        } else {
          callback();
        }
      },
      flush(callback) {
        let output = "";
        try {
          buffered += decoder.end();
          output = buffered;
          buffered = "";
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (output) {
          callback(null, output);
        } else {
          callback();
        }
      },
    });
  }
}

function validateManifest(value: unknown, manifestPath: string): ViteCatalogManifest {
  if (!value || typeof value !== "object") {
    throw new TypeError(
      `Palamedes Vite catalog delivery manifest ${manifestPath} must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.locales) ||
    !record.locales.every((locale) => typeof locale === "string")
  ) {
    throw new TypeError(
      `Palamedes Vite catalog delivery manifest ${manifestPath} has invalid locales.`,
    );
  }
  if (!isStringRecord(record.importMaps)) {
    throw new TypeError(
      `Palamedes Vite catalog delivery manifest ${manifestPath} has invalid importMaps.`,
    );
  }
  const chunkImports = record.chunkImports === undefined ? {} : record.chunkImports;
  if (!isArrayRecord(chunkImports)) {
    throw new TypeError(
      `Palamedes Vite catalog delivery manifest ${manifestPath} has invalid chunkImports.`,
    );
  }
  return {
    locales: record.locales,
    importMaps: record.importMaps,
    chunkImports,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isArrayRecord(value: unknown): value is Record<string, readonly string[]> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => Array.isArray(item) && item.every((entry) => typeof entry === "string"),
    )
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function decodeChunk(decoder: StringDecoder, chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) return decoder.write(chunk);
  if (chunk instanceof Uint8Array) {
    return decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return String(chunk);
}

function createHeadCloseScanner(): {
  scan(value: string): number;
  sawHeadOpen(): boolean;
  hasPendingHeadCloseAtOrBefore(limit: number): boolean;
} {
  let state: "normal" | "comment" | "tag-attrs" | "raw-open" | "raw-body" = "normal";
  let rawTag = "";
  let quote: "" | '"' | "'" = "";
  let scanOffset = 0;
  let headOpened = false;
  let pendingHeadCloseStart = -1;

  return {
    sawHeadOpen(): boolean {
      return headOpened;
    },

    hasPendingHeadCloseAtOrBefore(limit: number): boolean {
      return pendingHeadCloseStart !== -1 && pendingHeadCloseStart <= limit;
    },

    scan(value: string): number {
      pendingHeadCloseStart = -1;
      let cursor = scanOffset;
      while (cursor < value.length) {
        if (state === "normal") {
          const lt = value.indexOf("<", cursor);
          if (lt === -1) {
            scanOffset = value.length;
            return -1;
          }
          cursor = lt;
          const remaining = value.length - cursor;
          if (remaining === 1) {
            // A lone `<` at chunk end could begin `</head>`, `<head>`, `<!--`, etc.
            scanOffset = cursor;
            pendingHeadCloseStart = cursor;
            return -1;
          }

          const nextCode = value.charCodeAt(cursor + 1);
          if (nextCode === 33 /* ! */) {
            if (remaining < 4) {
              if ("<!--".startsWith(value.slice(cursor))) {
                scanOffset = cursor;
                return -1;
              }
              cursor += 1;
              continue;
            }
            if (value.startsWith("<!--", cursor)) {
              state = "comment";
              cursor += 4;
              continue;
            }
            cursor += 1;
            continue;
          }

          if (nextCode === 47 /* / */) {
            if (remaining < "</head".length) {
              if (asciiPrefixIgnoreCase("</head", value, cursor)) {
                scanOffset = cursor;
                pendingHeadCloseStart = cursor;
                return -1;
              }
              cursor += 1;
              continue;
            }
            if (asciiEqualsIgnoreCase(value, cursor, "</head")) {
              let after = cursor + "</head".length;
              while (after < value.length && isAsciiWhitespace(value.charCodeAt(after))) {
                after += 1;
              }
              if (after >= value.length) {
                // Only treat as pending </head> while whitespace stays bounded.
                if (after - cursor <= 64) {
                  pendingHeadCloseStart = cursor;
                }
                scanOffset = cursor;
                return -1;
              }
              if (value.charCodeAt(after) === 62 /* > */) {
                scanOffset = cursor;
                return cursor;
              }
              cursor += "</head".length;
              continue;
            }
            cursor += 1;
            continue;
          }

          if (!isAsciiAlpha(nextCode)) {
            cursor += 1;
            continue;
          }

          // Check for `<head` opener so cap overflow on real <head> fails closed.
          if (remaining <= "<head".length) {
            if (asciiPrefixIgnoreCase("<head", value, cursor)) {
              scanOffset = cursor;
              return -1;
            }
          } else if (
            asciiEqualsIgnoreCase(value, cursor, "<head") &&
            isHtmlTagBoundary(value.charCodeAt(cursor + "<head".length))
          ) {
            headOpened = true;
            state = "tag-attrs";
            quote = "";
            cursor += "<head".length;
            continue;
          }

          let matchedRaw: string | undefined;
          let partialRaw = false;
          for (const tag of HEAD_RAW_TAGS) {
            const opener = `<${tag}`;
            if (remaining <= opener.length) {
              if (asciiPrefixIgnoreCase(opener, value, cursor)) {
                partialRaw = true;
                break;
              }
            } else if (
              asciiEqualsIgnoreCase(value, cursor, opener) &&
              isHtmlTagBoundary(value.charCodeAt(cursor + opener.length))
            ) {
              matchedRaw = tag;
              break;
            }
          }
          if (partialRaw) {
            scanOffset = cursor;
            return -1;
          }
          if (matchedRaw) {
            state = "raw-open";
            rawTag = matchedRaw;
            quote = "";
            cursor += 1 + matchedRaw.length;
            continue;
          }

          // Skip attributes of any regular start tag (e.g. `<meta content="The <style> element">`)
          // so quoted `<style>` / `<script>` / `</head>` text never enters raw mode or closes head.
          state = "tag-attrs";
          quote = "";
          cursor += 2;
          continue;
        }

        if (state === "comment") {
          const end = value.indexOf("-->", cursor);
          if (end === -1) {
            scanOffset = Math.max(cursor, value.length - 2);
            return -1;
          }
          cursor = end + 3;
          state = "normal";
          continue;
        }

        if (state === "tag-attrs" || state === "raw-open") {
          let foundEnd = -1;
          for (let index = cursor; index < value.length; index += 1) {
            const character = value[index];
            if (quote) {
              if (character === quote) quote = "";
            } else if (character === '"' || character === "'") {
              quote = character;
            } else if (character === ">") {
              foundEnd = index;
              break;
            }
          }
          if (foundEnd === -1) {
            scanOffset = value.length;
            return -1;
          }
          cursor = foundEnd + 1;
          quote = "";
          state = state === "raw-open" ? "raw-body" : "normal";
          continue;
        }

        // state === "raw-body"
        const closeNeedle = `</${rawTag}`;
        const rawLt = value.indexOf("<", cursor);
        if (rawLt === -1) {
          scanOffset = value.length;
          return -1;
        }
        cursor = rawLt;
        const rawRemaining = value.length - cursor;
        if (rawRemaining <= closeNeedle.length) {
          if (asciiPrefixIgnoreCase(closeNeedle, value, cursor)) {
            scanOffset = cursor;
            return -1;
          }
          cursor += 1;
          continue;
        }
        if (
          asciiEqualsIgnoreCase(value, cursor, closeNeedle) &&
          isHtmlTagBoundary(value.charCodeAt(cursor + closeNeedle.length))
        ) {
          const gt = value.indexOf(">", cursor + closeNeedle.length);
          if (gt === -1) {
            scanOffset = cursor;
            return -1;
          }
          cursor = gt + 1;
          state = "normal";
          rawTag = "";
          continue;
        }
        cursor += 1;
      }
      scanOffset = value.length;
      return -1;
    },
  };
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function asciiEqualsIgnoreCase(value: string, offset: number, lowerTarget: string): boolean {
  if (offset + lowerTarget.length > value.length) return false;
  for (let index = 0; index < lowerTarget.length; index += 1) {
    let code = value.charCodeAt(offset + index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== lowerTarget.charCodeAt(index)) return false;
  }
  return true;
}

function asciiPrefixIgnoreCase(lowerTarget: string, value: string, offset: number): boolean {
  const length = value.length - offset;
  if (length > lowerTarget.length) return false;
  for (let index = 0; index < length; index += 1) {
    let code = value.charCodeAt(offset + index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== lowerTarget.charCodeAt(index)) return false;
  }
  return true;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

function isHtmlTagBoundary(code: number): boolean {
  return isAsciiWhitespace(code) || code === 47 /* / */ || code === 62; /* > */
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** Replace or add attributes of the document's `<html>` start tag. */
function setHtmlAttributes(head: string, attributes: Readonly<Record<string, string>>): string {
  return head.replace(/<html(?=[\s/>])[^>]*>/iu, (tag) => {
    let result = tag;
    for (const [name, value] of Object.entries(attributes)) {
      const attribute = ` ${name}="${escapeAttribute(value)}"`;
      // The leading whitespace keeps `xml:lang` and `data-lang` apart from `lang`.
      const existing = new RegExp(
        `\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?(?=[\\s/>])`,
        "iu",
      );
      result = existing.test(result)
        ? result.replace(existing, () => attribute)
        : result.replace(/^<html/iu, () => `<html${attribute}`);
    }
    return result;
  });
}

function modulePreloads(head: string, binding: ViteCatalogBinding): string[] {
  const preloads = new Set<string>();
  for (const match of head.matchAll(/<(?:link|script)\b[^>]*>/giu)) {
    const tag = match[0];
    const isModulePreload =
      /\brel=["']modulepreload["']/iu.test(tag) ||
      (/\btype=["']module["']/iu.test(tag) && /\bsrc=["'][^"']+["']/iu.test(tag));
    if (!isModulePreload) continue;
    const href =
      tag.match(/\bhref=["']([^"']+)["']/iu)?.[1] ?? tag.match(/\bsrc=["']([^"']+)["']/iu)?.[1];
    if (!href) continue;
    const key = assetKey(href);
    if (!Object.hasOwn(binding.chunkImports, key)) continue;
    for (const bare of binding.chunkImports[key] ?? []) {
      const asset = Object.hasOwn(binding.imports, bare) ? binding.imports[bare] : undefined;
      if (asset) preloads.add(asset);
    }
  }
  return [...preloads].sort();
}

function assetKey(href: string): string {
  let pathname = href;
  try {
    pathname = new URL(href, "https://palamedes.invalid").pathname;
  } catch {
    // Keep the original path for malformed but still useful Vite hrefs.
  }
  const assets = pathname.indexOf("assets/");
  return (assets !== -1 ? pathname.slice(assets) : pathname).replace(/^\/+/, "");
}

function escapeScriptData(value: string): string {
  return value
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** Options for a post-prerender static document. Every script is approved by
 * the SHA-256 digest of its complete original element, in document order. */
export type StaticViteDocumentOptions = {
  readonly html: string;
  readonly allowedScripts: readonly string[];
  /** Explicit byte/count bounds for all executable and data script elements. */
  readonly scriptLimits: {
    readonly maxCount: number;
    readonly maxElementBytes: number;
    readonly maxTotalBytes: number;
  };
  readonly locale:
    | { readonly kind: "document" }
    | { readonly kind: "fallback"; readonly policyModule: string };
};

export type StaticViteCatalogBootstrapOptions = ViteCatalogDeliveryOptions & {
  /** Root-relative public URL prefix for the generated bootstrap, default `/`. */
  readonly assetBase?: string;
};

/** Prepare a framework-produced static document after its prerender step. */
export function createStaticViteCatalogBootstrap(options: StaticViteCatalogBootstrapOptions) {
  const assetBase = options.assetBase ?? "/";
  if (
    !/^\/(?!\/)(?:[A-Za-z0-9._~-]+\/)*$/u.test(assetBase) ||
    assetBase.split("/").includes("..")
  ) {
    throw new Error("Static catalog asset base must be a root-relative directory ending in /.");
  }
  const delivery = createViteCatalogDelivery(options);
  return {
    transformDocument(input: StaticViteDocumentOptions) {
      return transformStaticViteDocument(delivery, input, assetBase);
    },
  };
}

type StaticNode = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: StaticNode[];
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { endOffset: number };
    endTag?: { startOffset: number };
  };
};

function staticHash(source: string): string {
  return `sha256-${createHash("sha256").update(source).digest("base64")}`;
}

function localScriptUrl(value: string): boolean {
  return /^\/(?!\/)[^?#\s]*\.js$/u.test(value) && !value.includes("\\");
}

function transformStaticViteDocument(
  delivery: ReturnType<typeof createViteCatalogDelivery>,
  input: StaticViteDocumentOptions,
  assetBase: string,
) {
  const document = parse(input.html, { sourceCodeLocationInfo: true }) as StaticNode;
  const scripts: StaticNode[] = [];
  const preloads: StaticNode[] = [];
  let body: StaticNode | undefined;
  let htmlElement: StaticNode | undefined;
  function visit(node: StaticNode) {
    if (node.tagName === "html") htmlElement = node;
    if (node.tagName === "body") body = node;
    if (node.tagName === "script") scripts.push(node);
    if (
      node.tagName === "link" &&
      node.attrs?.some((a) => a.name === "rel" && a.value.toLowerCase() === "modulepreload")
    )
      preloads.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  if (!body?.sourceCodeLocation?.endTag || !htmlElement)
    throw new Error("Static catalog delivery requires an explicit HTML body.");
  const limits = input.scriptLimits;
  if (
    !limits ||
    ![limits.maxCount, limits.maxElementBytes, limits.maxTotalBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("Static document requires positive script limits.");
  if (scripts.length > limits.maxCount)
    throw new Error("Static document exceeds the script count limit.");
  let totalBytes = 0;
  if (scripts.length !== input.allowedScripts.length)
    throw new Error("Unexpected static document script count.");
  const removals: { start: number; end: number; replacement?: string }[] = [];
  const startup: { index: number; src?: string; text?: string; async: boolean }[] = [];
  const cspHashes: string[] = [];
  for (const [index, script] of scripts.entries()) {
    const loc = script.sourceCodeLocation;
    if (!loc?.startTag || !loc.endTag)
      throw new Error("Static document script has no explicit source bounds.");
    const elementSource = input.html.slice(loc.startOffset, loc.endOffset);
    const bytes = Buffer.byteLength(elementSource);
    totalBytes += bytes;
    if (bytes > limits.maxElementBytes || totalBytes > limits.maxTotalBytes)
      throw new Error("Static document exceeds the script byte limit.");
    if (staticHash(elementSource) !== input.allowedScripts[index])
      throw new Error("Unexpected static document script; approve its exact element digest.");
    const attrs = Object.fromEntries((script.attrs ?? []).map((attr) => [attr.name, attr.value]));
    const content = input.html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    if (
      (script.attrs ?? []).some(
        (attr) => attr.name.startsWith("on") || attr.name.startsWith("data-palamedes-"),
      )
    )
      throw new Error("Unsupported static script attribute.");
    if (attrs.src && !localScriptUrl(attrs.src))
      throw new Error("Static scripts must use local JavaScript URLs.");
    if (attrs.type?.toLowerCase() === "importmap")
      throw new Error("Static document must not contain an existing import map.");
    if (attrs.type?.toLowerCase() !== "module") {
      if ("defer" in attrs)
        throw new Error(
          "Static catalog delivery does not support deferred classic scripts; remove defer or handle this document separately.",
        );
      continue;
    }
    if ((script.attrs ?? []).some((attr) => !["type", "src", "async"].includes(attr.name)))
      throw new Error("Unsupported static module script attribute.");
    if (attrs.src && (!localScriptUrl(attrs.src) || content.trim()))
      throw new Error("Static module entry must be a local script without inline content.");
    if (attrs.src) startup.push({ index, src: attrs.src, async: "async" in attrs });
    else {
      startup.push({ index, text: content, async: "async" in attrs });
      cspHashes.push(staticHash(content));
    }
    removals.push({
      start: loc.startOffset,
      end: loc.endOffset,
      replacement: `<script type="application/x-palamedes-module" data-palamedes-startup="${index}"></script>`,
    });
  }
  if (!startup.length) throw new Error("Static document has no module startup.");
  for (const node of preloads) {
    const loc = node.sourceCodeLocation;
    if (!loc) throw new Error("Static module preload has no source bounds.");
    removals.push({ start: loc.startOffset, end: loc.endOffset });
  }
  if (input.locale.kind === "fallback" && !localScriptUrl(input.locale.policyModule))
    throw new Error("Static locale policy must be a local JavaScript module.");
  const manifest = delivery.readManifest();
  if (!manifest) throw new Error("Static catalog delivery requires a production manifest.");
  const maps: Record<string, { imports: Readonly<Record<string, string>> }> = Object.create(null);
  const probes: Record<string, string[]> = Object.create(null);
  for (const locale of manifest.locales) {
    const mapName = Object.hasOwn(manifest.importMaps, locale)
      ? manifest.importMaps[locale]
      : undefined;
    if (
      !mapName ||
      path.isAbsolute(mapName) ||
      path.win32.isAbsolute(mapName) ||
      mapName.split(/[\\/]/u).some((part) => part === ".." || part === ".")
    ) {
      throw new Error("Static catalog manifest has an invalid import-map path.");
    }
    const binding = delivery.getLocaleBinding(locale);
    if (!binding) throw new Error("Static catalog delivery requires a production binding.");
    if (
      Object.entries(binding.imports).some(([key, value]) => {
        const validKey = /^#pmds\/[a-f0-9]{12}$/u.test(key);
        const name = value.split("/").at(-1) ?? "";
        const prefix = name.match(/^palamedes-m-[a-f0-9]{12}\./u)?.[0];
        const suffix = prefix ? name.slice(prefix.length) : "";
        return (
          !validKey ||
          !localScriptUrl(value) ||
          !prefix ||
          !suffix.startsWith(`${locale}-`) ||
          !/^[a-f0-9]{8}\.js$/u.test(suffix.slice(locale.length + 1))
        );
      })
    )
      throw new Error("Static catalog import map has an invalid binding.");
    maps[locale] = { imports: binding.imports };
    probes[locale] = modulePreloads(input.html, binding);
    cspHashes.push(staticHash(JSON.stringify(maps[locale])));
  }
  const localeExpr =
    input.locale.kind === "document"
      ? "document.documentElement.lang"
      : `await (await import(${JSON.stringify(input.locale.policyModule)})).resolveLocale({pathname:location.pathname,search:location.search,languages:[...navigator.languages]})`;
  const source = `const maps=${JSON.stringify(maps)},probes=${JSON.stringify(probes)},startup=${JSON.stringify(startup)};try{const locale=${localeExpr};if(!Object.hasOwn(maps,locale))throw new Error("Unsupported document catalog locale.");${input.locale.kind === "fallback" ? "document.documentElement.lang=locale;" : ""}const map=document.createElement("script");map.type="importmap";map.textContent=JSON.stringify(maps[locale]);document.head.append(map);const ready=Promise.all(probes[locale].map(url=>import(url)));globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]=ready;await ready;globalThis[Symbol.for("palamedes.document-catalogs-ready")]=true;for(const entry of startup){const script=document.createElement("script");script.type="module";script.async=entry.async;if(entry.src)script.src=entry.src;else script.textContent=entry.text;script.addEventListener("error",showError,{once:true});document.querySelector("script[data-palamedes-startup]").replaceWith(script)}document.querySelector("script[data-palamedes-bootstrap]")?.remove()}catch{showError()}function showError(){const template=document.querySelector("template[data-palamedes-error]");if(template)document.body.replaceChildren(template.content.cloneNode(true));else document.body.innerHTML='<main role="alert"><h1>This page is temporarily unavailable.</h1><p>Reload the page to try again.</p><a href="" target="_self">Reload page</a> <a href="/" target="_self">Go home</a></main>'}`;
  const fileName = `assets/palamedes-static-${createHash("sha256").update(source).digest("hex").slice(0, 12)}.js`;
  const insert = body.sourceCodeLocation.endTag.startOffset;
  removals.push({ start: insert, end: insert });
  removals.sort((a, b) => b.start - a.start);
  let html = input.html;
  for (const removal of removals)
    html =
      html.slice(0, removal.start) +
      (removal.start === insert && removal.end === insert
        ? `<script type="module" data-palamedes-bootstrap src="${assetBase}${fileName}" integrity="${staticHash(source)}"></script>`
        : (removal.replacement ?? "")) +
      html.slice(removal.end);
  return { html, bootstrap: { fileName, source, integrity: staticHash(source) }, cspHashes };
}
