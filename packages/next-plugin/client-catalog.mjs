// Production client catalogs live outside the bundler graph. The document
// links this locale's catalog map, a static module that resolves each module
// key to the message asset of the chunk that carries it. Both imports below
// stay native.
const MAP_ELEMENT_ID = "palamedes-client-catalogs";
const MARKER_PREFIX = "pmds-next:";
const KEY_LENGTH = 12;
const RETRY_PARAM = "pmds-retry";
const STATIC_CATALOG_DIRECTORY_SUFFIX = "/_next/static/palamedes/";
const DEFAULT_MAP_PATH_PATTERN = /^\/_next\/static\/palamedes\/(catalogs\.[^/]+)$/u;
const SAFE_ASSET_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

let catalogMap;

function isHttpUrl(url) {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isSafeAssetFileName(fileName) {
  return (
    typeof fileName === "string" && SAFE_ASSET_FILE_NAME.test(fileName) && !fileName.includes("..")
  );
}

function configuredCatalogBase() {
  try {
    // Next.js inlines nextConfig.env values into client bundles when referenced
    // directly as `process.env.<NAME>`.
    return process.env.PALAMEDES_NEXT_CATALOG_BASE;
  } catch {
    return;
  }
}

function pageLocationUrl() {
  const href = globalThis.location?.href;
  if (typeof href !== "string" || !href) return;
  try {
    const parsed = new URL(href);
    return isHttpUrl(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

function validateMapUrl(rawHref) {
  if (typeof rawHref !== "string" || !rawHref) return;
  const pageUrl = pageLocationUrl();
  if (!pageUrl) return;

  let parsed;
  try {
    parsed = new URL(rawHref, pageUrl);
  } catch {
    return;
  }
  if (!isHttpUrl(parsed) || parsed.username || parsed.password) return;

  const base = configuredCatalogBase();
  if (typeof base === "string" && base.length > 0) {
    let expectedBase;
    try {
      expectedBase = new URL(base, pageUrl);
    } catch {
      return;
    }
    if (
      !isHttpUrl(expectedBase) ||
      !expectedBase.pathname.endsWith(STATIC_CATALOG_DIRECTORY_SUFFIX) ||
      parsed.origin !== expectedBase.origin ||
      !parsed.pathname.startsWith(expectedBase.pathname)
    ) {
      return;
    }
    const fileName = parsed.pathname.slice(expectedBase.pathname.length);
    if (!fileName.startsWith("catalogs.") || !isSafeAssetFileName(fileName)) return;
    return parsed.href;
  }

  if (parsed.origin !== pageUrl.origin) return;
  const match = DEFAULT_MAP_PATH_PATTERN.exec(parsed.pathname);
  if (!match || !isSafeAssetFileName(match[1])) return;
  return parsed.href;
}

function mapUrl() {
  // Require the real <link rel="modulepreload"> rendered inside <head> so
  // user-supplied markup or <base href> cannot clobber the catalog map URL.
  const el = document.getElementById(MAP_ELEMENT_ID);
  if (
    typeof HTMLLinkElement !== "function" ||
    !(el instanceof HTMLLinkElement) ||
    el.rel !== "modulepreload" ||
    !document.head ||
    el.parentElement !== document.head
  ) {
    return;
  }
  return validateMapUrl(el.href);
}

function waitForMapUrl() {
  return new Promise((resolve, reject) => {
    const finish = () => {
      const url = mapUrl();
      if (url) resolve(url);
      else
        reject(
          new Error(
            "The document has no Palamedes client catalog map. Render <PalamedesClientCatalogs locale={locale} /> in the root layout's <head>.",
          ),
        );
    };
    // <PalamedesClientCatalogs> renders in <head>, so the link is usually
    // parsed before any chunk runs. An async chunk can still win that race; it
    // then waits for the parser instead of failing.
    const url = mapUrl();
    if (url) resolve(url);
    else if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", finish, { once: true });
    else finish();
  });
}

function importAsset(url) {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

// Browsers keep a failed module fetch in the module map for that URL, so a
// retry of the same URL would fail without a request. The query gives the
// retry its own module map entry; the static file server ignores it.
function retryUrl(url) {
  const retry = new URL(url);
  retry.searchParams.set(RETRY_PARAM, "1");
  return retry.href;
}

// One retry covers a dropped connection or a server hiccup. A missing or
// broken file fails the same way twice and reaches the caller's error.
async function importWithRetry(url) {
  try {
    return await importAsset(url);
  } catch {
    return importAsset(retryUrl(url));
  }
}

async function loadCatalogMap() {
  const url = await waitForMapUrl();
  let map;
  try {
    ({ default: map } = await importWithRetry(url));
  } catch (error) {
    throw new Error(
      `Palamedes could not load the client catalog map from ${url}, also after one retry. Check that .next/static/palamedes is served from the same build as the document.`,
      { cause: error },
    );
  }
  if (
    !map ||
    typeof map !== "object" ||
    !map.assets ||
    typeof map.assets !== "object" ||
    Array.isArray(map.assets)
  ) {
    throw new Error(`${url} is not a Palamedes client catalog map: it exports no assets.`);
  }
  const mapParsedUrl = new URL(url);
  const mapDirectory = mapParsedUrl.pathname.slice(0, mapParsedUrl.pathname.lastIndexOf("/") + 1);
  const modules = new Map();
  for (const [fileName, keys] of Object.entries(map.assets)) {
    if (!isSafeAssetFileName(fileName) || typeof keys !== "string") {
      throw new Error(
        `The Palamedes client catalog map from ${url} contains an invalid asset entry "${fileName}".`,
      );
    }
    const assetUrl = new URL(fileName, mapParsedUrl);
    if (
      assetUrl.origin !== mapParsedUrl.origin ||
      assetUrl.pathname !== `${mapDirectory}${fileName}`
    ) {
      throw new Error(
        `The Palamedes client catalog map from ${url} resolves "${fileName}" outside its static directory.`,
      );
    }
    for (let index = 0; index < keys.length; index += KEY_LENGTH) {
      modules.set(keys.slice(index, index + KEY_LENGTH), assetUrl.href);
    }
  }
  return { locale: map.locale, modules };
}

function readCatalogMap() {
  if (!catalogMap) {
    catalogMap = loadCatalogMap();
    // A failed map load fails every module waiting on it; a later call, for
    // example after an error boundary reset, starts over.
    catalogMap.catch(() => {
      catalogMap = undefined;
    });
  }
  return catalogMap;
}

// Names the module in errors. The payload is the base64url JSON that the
// loader embedded next to the key; a marker without one falls back to the key.
function moduleName(marker, key) {
  try {
    const payload = marker.slice(MARKER_PREFIX.length + key.length + 1);
    const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)).source ?? key;
  } catch {
    return key;
  }
}

/** Loads the messages of one translated module for the document locale. */
export async function loadClientCatalog(marker) {
  const key = marker.slice(MARKER_PREFIX.length).split(":", 1)[0];
  const map = await readCatalogMap();
  const locale = document.documentElement.lang;
  if (map.locale !== locale) {
    throw new Error(
      `The Palamedes client catalog map is for locale "${map.locale}", but the document locale is "${locale}". Render <PalamedesClientCatalogs> with the locale of <html lang>.`,
    );
  }
  const url = map.modules.get(key);
  if (url === undefined) {
    throw new Error(
      `The Palamedes client catalog map has no "${locale}" asset for ${moduleName(marker, key)} (module key ${key}). The document and its client chunks come from different builds, or the build did not find this module's marker in its chunks.`,
    );
  }
  let fragment;
  try {
    fragment = await importWithRetry(url);
  } catch (error) {
    throw new Error(
      `Palamedes could not load the "${locale}" messages of ${moduleName(marker, key)} from ${url}, also after one retry. Check that .next/static/palamedes is served from the same build as the client chunks.`,
      { cause: error },
    );
  }
  if (fragment.messages === null || typeof fragment.messages !== "object") {
    throw new Error(`${url} is not a Palamedes client catalog asset: it exports no messages.`);
  }
  return fragment.messages;
}

/*
 * Permutation delivery (experimentalClientCatalogPermutations): the loader
 * passes the marker through this function, and the post-compile step replaces
 * the literal with the locale's compiled messages in every locale copy of the
 * chunk. Only a locale-neutral chunk still carries the string.
 */
export function clientCatalogMessages(value) {
  if (typeof value === "string" && value.startsWith(MARKER_PREFIX)) {
    const key = value.slice(MARKER_PREFIX.length).split(":", 1)[0];
    throw new Error(
      `Palamedes loaded a locale-neutral client chunk for ${moduleName(value, key)}. The server did not select this locale's chunk copy: bind the permutations in every rendering process and make locale switches full document navigations.`,
    );
  }
  return value;
}
