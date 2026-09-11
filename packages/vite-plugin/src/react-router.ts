import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PassThrough, Transform, type TransformCallback } from "node:stream";

const SPLIT_MANIFEST_NAME = "palamedes-split-manifest.json";

export type ReactRouterCatalogManifest = {
  readonly locales: readonly string[];
  readonly importMaps: Readonly<Record<string, string>>;
  readonly chunkImports: Readonly<Record<string, readonly string[]>>;
};

export type ReactRouterCatalogBinding = {
  readonly locale: string;
  readonly importMapJson: string;
  readonly imports: Readonly<Record<string, string>>;
  readonly chunkImports: Readonly<Record<string, readonly string[]>>;
};

export type ReactRouterCatalogDeliveryOptions = {
  /** React Router's built client directory, normally `build/client`. */
  readonly clientDirectory: string;
  /** Use development-generated active-locale dependencies before a client build exists. */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
};

export type ReactRouterDocumentTransformOptions = {
  /** A CSP nonce for the inline import-map element. */
  readonly nonce?: string;
  /** Trusted catalog-independent host error markup; omit for a generic reload/home view. */
  readonly errorHtml?: string;
};

/**
 * Owns the server half of Vite's locale-bound catalog delivery for React
 * Router. Applications select a locale; they do not read manifests or splice
 * import maps and preloads into the document themselves.
 */
export function createReactRouterCatalogDelivery(options: ReactRouterCatalogDeliveryOptions): {
  readManifest(): ReactRouterCatalogManifest | null;
  getLocaleBinding(locale: string): ReactRouterCatalogBinding | null;
  createDocumentTransform(
    binding: ReactRouterCatalogBinding | null,
    transformOptions?: ReactRouterDocumentTransformOptions,
  ): Transform;
} {
  const clientDirectory = path.resolve(options.clientDirectory);
  const manifestName = options.manifestName ?? SPLIT_MANIFEST_NAME;
  let manifestStamp: string | undefined;
  let manifest: ReactRouterCatalogManifest | null | undefined;

  function readManifest(): ReactRouterCatalogManifest | null {
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
        return null;
      }
      throw new Error(
        `Palamedes React Router delivery could not read ${manifestPath}; the Vite client manifest is required before browser modules execute.`,
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
      throw new Error(`Palamedes React Router delivery could not parse ${manifestPath}.`, {
        cause: error,
      });
    }
    manifest = validateManifest(parsed, manifestPath);
    manifestStamp = stamp;
    return manifest;
  }

  function getLocaleBinding(locale: string): ReactRouterCatalogBinding | null {
    const current = readManifest();
    if (!current) return null;
    if (!current.locales.includes(locale)) {
      throw new Error(
        `Palamedes React Router delivery has no generated import map for locale ${JSON.stringify(locale)} in ${path.join(clientDirectory, manifestName)}.`,
      );
    }
    const mapName = current.importMaps[locale];
    if (!mapName) {
      throw new Error(
        `Palamedes React Router delivery manifest ${path.join(clientDirectory, manifestName)} is missing the import map for locale ${JSON.stringify(locale)}.`,
      );
    }
    const mapPath = path.resolve(clientDirectory, mapName);
    let importMapJson: string;
    try {
      importMapJson = readFileSync(mapPath, "utf8");
      const candidate = JSON.parse(importMapJson) as { imports?: unknown };
      if (!isStringRecord(candidate.imports)) throw new TypeError("the imports object is missing");
    } catch (error) {
      throw new Error(
        `Palamedes React Router delivery could not read the generated import map for locale ${JSON.stringify(locale)} at ${mapPath}.`,
        { cause: error },
      );
    }
    const parsed = JSON.parse(importMapJson) as { imports: Record<string, string> };
    return {
      locale,
      importMapJson,
      imports: parsed.imports,
      chunkImports: current.chunkImports,
    };
  }

  return { readManifest, getLocaleBinding, createDocumentTransform };

  function createDocumentTransform(
    binding: ReactRouterCatalogBinding | null,
    transformOptions: ReactRouterDocumentTransformOptions = {},
  ): Transform {
    if (!binding) return new PassThrough();
    const nonce = transformOptions.nonce
      ? ` nonce="${escapeAttribute(transformOptions.nonce)}"`
      : "";
    const importMap = `<script type="importmap"${nonce}>${escapeScriptData(binding.importMapJson)}</script>`;
    const decoder = new StringDecoder("utf8");
    let buffered = "";
    let injected = false;
    return new Transform({
      transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
        const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
        if (injected) {
          callback(null, text);
          return;
        }
        buffered += text;
        const headEnd = buffered.indexOf("</head>");
        if (headEnd === -1) {
          callback();
          return;
        }
        injected = true;
        const head = buffered.slice(0, headEnd);
        const tail = buffered.slice(headEnd);
        const preloads = modulePreloads(head, binding);
        const errorHtml =
          transformOptions.errorHtml ??
          '<main role="alert" data-palamedes-catalog-error><h1>This page is temporarily unavailable.</h1><p>Reload the page to try again.</p><a href="">Reload page</a> <a href="/">Go home</a></main>';
        // React Router imports initial routes before executing entry.client.
        // This independent module observes the same dependency promises and can
        // show ordinary host error markup even when that entry never executes.
        const probe = `<script${nonce}>globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")]=Promise.all(${escapeScriptData(JSON.stringify(preloads))}.map(url=>import(url)));globalThis[Symbol.for("palamedes.document-catalogs-ready-promise")].then(()=>{globalThis[Symbol.for("palamedes.document-catalogs-ready")]=true}).catch(async()=>{if(!document.body)await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));const template=document.createElement("template");template.innerHTML=${escapeScriptData(JSON.stringify(errorHtml))};document.body.replaceChildren(template.content.cloneNode(true));});</script>`;
        const links = preloads
          .map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`)
          .join("");
        callback(
          null,
          `${head.replace(/<head\b[^>]*>/iu, (tag) => `${tag}${importMap}`)}${probe}${links}${tail}`,
        );
        buffered = "";
      },
      flush(callback) {
        buffered += decoder.end();
        if (buffered) this.push(buffered);
        callback();
      },
    });
  }
}

function validateManifest(value: unknown, manifestPath: string): ReactRouterCatalogManifest {
  if (!value || typeof value !== "object") {
    throw new TypeError(
      `Palamedes React Router delivery manifest ${manifestPath} must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.locales) ||
    !record.locales.every((locale) => typeof locale === "string")
  ) {
    throw new TypeError(
      `Palamedes React Router delivery manifest ${manifestPath} has invalid locales.`,
    );
  }
  if (!isStringRecord(record.importMaps)) {
    throw new TypeError(
      `Palamedes React Router delivery manifest ${manifestPath} has invalid importMaps.`,
    );
  }
  const chunkImports = record.chunkImports ?? {};
  if (!isArrayRecord(chunkImports)) {
    throw new TypeError(
      `Palamedes React Router delivery manifest ${manifestPath} has invalid chunkImports.`,
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
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isArrayRecord(value: unknown): value is Record<string, readonly string[]> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value).every(
      (item) => Array.isArray(item) && item.every((entry) => typeof entry === "string"),
    )
  );
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function modulePreloads(head: string, binding: ReactRouterCatalogBinding): string[] {
  const preloads = new Set<string>();
  for (const match of head.matchAll(/<link\s+[^>]*rel=["']modulepreload["'][^>]*>/giu)) {
    const href = match[0].match(/\bhref=["']([^"']+)["']/iu)?.[1];
    if (!href) continue;
    const key = assetKey(href);
    for (const bare of binding.chunkImports[key] ?? []) {
      const asset = binding.imports[bare];
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
