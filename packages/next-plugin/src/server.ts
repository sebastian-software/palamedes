/*
 * Next.js has no public API for the identity of one App Router render that also
 * survives React resuming work in an earlier async context, static generation,
 * and Client Component SSR. This internal module is therefore an explicit,
 * version-verified dependency (docs/stability.md, "Next.js contract");
 * withPalamedes() fails the build when it no longer resolves.
 */
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import { createServerI18nScope, type ServerI18nScope } from "@palamedes/runtime/server";
import type { I18nInstance } from "@palamedes/runtime";
import { createI18n, type CreateI18nOptions, type PalamedesI18n } from "@palamedes/core";
import { loadServerCatalog } from "@palamedes/next-plugin/server-catalogs";
import { readFileSync } from "node:fs";
import path from "node:path";

let clientCatalogManifest: Record<string, Record<string, string>> | null | undefined;

const CLIENT_CATALOG_MANIFEST = "palamedes-client-catalogs.json";

/*
 * The manifest is written after compilation, so the server reads it from the
 * build output at runtime. `PALAMEDES_NEXT_DIST_DIR` is the dist dir relative
 * to the project, and the working directory is the project directory under
 * `next start`, in the standalone `server.js` (it changes into its own
 * directory), and in hosted functions. withPalamedes() adds the manifest to
 * the server traces, so it travels with every deployment of the build.
 */
function readClientCatalogManifest(distDir: string): Record<string, Record<string, string>> {
  const manifestPath = path.resolve(process.cwd(), distDir, CLIENT_CATALOG_MANIFEST);
  try {
    return JSON.parse(readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8")).locales;
  } catch (error) {
    throw new Error(
      `Palamedes Next client catalogs: cannot read ${manifestPath}. This build delivers client catalogs as assets, so the server needs the manifest from its build output. Start the server in the project directory (next start) or from the standalone output (node server.js), and keep ${distDir}/${CLIENT_CATALOG_MANIFEST} when you copy the build.`,
      { cause: error },
    );
  }
}

/**
 * Experimental: the JSON for a `<script id="palamedes-client-catalogs"
 * type="application/json">` element in the root layout's `<head>`, or
 * `undefined` when the build delivers client catalogs in its module graph.
 */
export function clientCatalogMap(locale: string): string | undefined {
  if (clientCatalogManifest === undefined) {
    const distDir = process.env.PALAMEDES_NEXT_DIST_DIR;
    clientCatalogManifest = distDir ? readClientCatalogManifest(distDir) : null;
  }
  const assets = clientCatalogManifest?.[locale];
  if (!assets) return undefined;
  return JSON.stringify({ locale, assets }).replaceAll("<", "\\u003c");
}

const NEXT_RENDER_REQUEST_KEY_PROVIDER = Symbol.for(
  "palamedes.nextPlugin.renderRequestKeyProvider",
);

function nextRenderStorage(): typeof workAsyncStorage {
  // Bundlers turn a moved CommonJS export into `undefined`, not a build error.
  const storage = workAsyncStorage as Partial<typeof workAsyncStorage> | undefined;
  if (typeof storage?.getStore !== "function") {
    throw new TypeError(
      "@palamedes/next-plugin/server could not read workAsyncStorage from next/dist/server/app-render/work-async-storage.external.js. This Next.js release changed the internal render storage that keys request-scoped i18n; install a verified Next.js 16 release.",
    );
  }
  return workAsyncStorage;
}

/**
 * Create an i18n scope keyed to Next.js' complete App Router render lifetime.
 * The render key remains stable when React suspends and resumes work in a
 * different async execution context.
 */
export function createNextServerI18nScope<
  T extends I18nInstance = I18nInstance,
>(): ServerI18nScope<T> {
  const renderStorage = nextRenderStorage();
  return createServerI18nScope<T>({
    requestKeyProvider: {
      get: () => renderStorage.getStore(),
      // A stable ID lets runtime registration replace this closure during HMR
      // instead of retaining one provider for every module evaluation.
      id: NEXT_RENDER_REQUEST_KEY_PROVIDER,
    },
  });
}

export type { ServerI18nScope };

let automaticScope: ServerI18nScope<PalamedesI18n> | undefined;

/** Load the active locale once per server generation and create isolated request state. */
export async function createNextServerI18n(
  options: CreateI18nOptions & { locale: string },
): Promise<PalamedesI18n> {
  const messages = await loadServerCatalog(options.locale);
  const i18n = createI18n(options);
  i18n.load(options.locale, messages);
  (automaticScope ??= createNextServerI18nScope<PalamedesI18n>()).activate(i18n);
  return i18n;
}
