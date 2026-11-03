// Production client catalogs live outside the bundler graph. The document
// links this locale's catalog map, a static module that resolves each module
// key to the message asset of the chunk that carries it. Both imports below
// stay native.
const MAP_ELEMENT_ID = "palamedes-client-catalogs";
const MARKER_PREFIX = "pmds-next:";
const KEY_LENGTH = 12;

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
      else reject(new Error("The document has no Palamedes client catalog map."));
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

async function loadCatalogMap() {
  const url = await waitForMapUrl();
  const { default: map } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  const modules = new Map();
  for (const [fileName, keys] of Object.entries(map.assets)) {
    const assetUrl = new URL(fileName, url).href;
    for (let index = 0; index < keys.length; index += KEY_LENGTH) {
      modules.set(keys.slice(index, index + KEY_LENGTH), assetUrl);
    }
  }
  return { locale: map.locale, modules };
}

/** Loads the messages of one translated module for the document locale. */
export async function loadClientCatalog(marker) {
  const key = marker.slice(MARKER_PREFIX.length).split(":", 1)[0];
  const map = await (catalogMap ??= loadCatalogMap());
  const locale = document.documentElement.lang;
  if (map.locale !== locale) {
    throw new Error("The Palamedes client catalog map does not match the document locale.");
  }
  const url = map.modules.get(key);
  if (url === undefined) {
    throw new Error(`The Palamedes client catalog map has no asset for module ${key}.`);
  }
  const fragment = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  return fragment.messages;
}
