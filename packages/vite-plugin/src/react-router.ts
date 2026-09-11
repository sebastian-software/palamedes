import { readFileSync, statSync } from "node:fs";
import path from "node:path";
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
  /** Permit the dev server's embedded sidecar mode before a client build exists. */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
};

export type ReactRouterDocumentTransformOptions = {
  /** A CSP nonce for the inline import-map element. */
  readonly nonce?: string;
};

export type ReactRouterCatalogFailureStore = {
  /** Install capture listeners before React Router starts hydrating. */
  install(): void;
  /** Return a failure captured before the host mounted, if any. */
  get(): Error | undefined;
  /** Subscribe the host error UI to later fragment failures. */
  subscribe(listener: (error: Error) => void): () => void;
  dispose(): void;
};

/**
 * Bridges browser import-map fragment failures into a host's normal error UI.
 * It deliberately filters to generated Palamedes assets, leaving unrelated
 * browser errors to the host. Install this before HydratedRouter mounts so a
 * failed modulepreload cannot disappear before the route tree exists.
 */
export function createReactRouterCatalogFailureStore(): ReactRouterCatalogFailureStore {
  let failure: Error | undefined;
  const listeners = new Set<(error: Error) => void>();
  const onError = (event: Event) => {
    const target = event.target as HTMLLinkElement | HTMLScriptElement | null;
    const source =
      (target instanceof HTMLLinkElement ? target.href : target instanceof HTMLScriptElement ? target.src : "") ||
      (event as ErrorEvent).filename ||
      "";
    if (!isCatalogAsset(source)) return;
    capture(new Error(`Palamedes catalog fragment failed to load: ${source}`));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    if (!isCatalogAsset(`${reason.message}\n${reason.stack ?? ""}`)) return;
    capture(reason);
  };

  return {
    install() {
      globalThis.addEventListener("error", onError, true);
      globalThis.addEventListener("unhandledrejection", onRejection);
    },
    get: () => failure,
    subscribe(listener) {
      listeners.add(listener);
      if (failure) listener(failure);
      return () => listeners.delete(listener);
    },
    dispose() {
      globalThis.removeEventListener("error", onError, true);
      globalThis.removeEventListener("unhandledrejection", onRejection);
      listeners.clear();
    },
  };

  function capture(error: Error) {
    if (failure) return;
    failure = error;
    for (const listener of listeners) listener(error);
  }
}

const MISSING_DEVELOPMENT_MANIFEST = Symbol("missing-development-manifest");

/**
 * Owns the server half of Vite's locale-bound catalog delivery for React
 * Router. Applications select a locale; they do not read manifests or splice
 * import maps and preloads into the document themselves.
 */
export function createReactRouterCatalogDelivery(
  options: ReactRouterCatalogDeliveryOptions,
): {
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
    const manifestPath = path.join(clientDirectory, manifestName);
    let stamp: string;
    try {
      const stat = statSync(manifestPath);
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch (error) {
      if (options.development && isMissingFile(error)) {
        manifest = MISSING_DEVELOPMENT_MANIFEST as unknown as null;
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
      const parsed = JSON.parse(importMapJson) as { imports?: unknown };
      if (!isStringRecord(parsed.imports)) throw new TypeError("the imports object is missing");
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
    const nonce = transformOptions.nonce ? ` nonce="${escapeAttribute(transformOptions.nonce)}"` : "";
    const importMap = `<script type="importmap"${nonce}>${binding.importMapJson}</script>`;
    let buffered = "";
    let injected = false;
    return new Transform({
      transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
        if (injected) {
          callback(null, chunk as Buffer | string);
          return;
        }
        buffered += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        const headEnd = buffered.indexOf("</head>");
        if (headEnd === -1) {
          callback();
          return;
        }
        injected = true;
        const head = buffered.slice(0, headEnd);
        const tail = buffered.slice(headEnd);
        const preloads = modulePreloads(head, binding);
        const links = preloads.map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`).join("");
        callback(null, `${head}${importMap}${links}${tail}`);
        buffered = "";
      },
      flush(callback) {
        if (buffered) this.push(buffered);
        callback();
      },
    });
  }
}

function validateManifest(value: unknown, manifestPath: string): ReactRouterCatalogManifest {
  if (!value || typeof value !== "object") {
    throw new TypeError(`Palamedes React Router delivery manifest ${manifestPath} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.locales) || !record.locales.every((locale) => typeof locale === "string")) {
    throw new TypeError(`Palamedes React Router delivery manifest ${manifestPath} has invalid locales.`);
  }
  if (!isStringRecord(record.importMaps)) {
    throw new TypeError(`Palamedes React Router delivery manifest ${manifestPath} has invalid importMaps.`);
  }
  const chunkImports = record.chunkImports ?? {};
  if (!isArrayRecord(chunkImports)) {
    throw new TypeError(`Palamedes React Router delivery manifest ${manifestPath} has invalid chunkImports.`);
  }
  return {
    locales: record.locales,
    importMaps: record.importMaps,
    chunkImports,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isArrayRecord(value: unknown): value is Record<string, readonly string[]> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).every(
      (item) => Array.isArray(item) && item.every((entry) => typeof entry === "string"),
    )
  );
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function isCatalogAsset(value: string): boolean {
  return /(?:^|[\\/])palamedes-m-[a-f0-9]+(?:[.-]|$)/iu.test(value);
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
  return (assets >= 0 ? pathname.slice(assets) : pathname).replace(/^\/+/, "");
}
