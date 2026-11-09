// Production client catalogs live outside the bundler graph. The document
// links this locale's catalog map, a static module that resolves each module
// key to the message asset of the chunk that carries it. Both imports below
// stay native.
const MAP_ELEMENT_ID = "palamedes-client-catalogs";
const MARKER_PREFIX = "pmds-next:";
const KEY_LENGTH = 12;
const RETRY_PARAM = "pmds-retry";

let catalogMap;

function mapUrl() {
  // The resolved href of the <link>, so a relative URL also works.
  return document.getElementById(MAP_ELEMENT_ID)?.href || undefined;
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
  const retry = new URL(url, document.baseURI);
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
  const modules = new Map();
  for (const [fileName, keys] of Object.entries(map.assets)) {
    const assetUrl = new URL(fileName, url).href;
    for (let index = 0; index < keys.length; index += KEY_LENGTH) {
      modules.set(keys.slice(index, index + KEY_LENGTH), assetUrl);
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
