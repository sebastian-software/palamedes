// Production client catalogs live outside the bundler graph. The ignored
// import below stays native, and the document's catalog map resolves each
// module key to the message asset of the chunk that carries it.
const MAP_ELEMENT_ID = "palamedes-client-catalogs";
const MARKER_PREFIX = "pmds-next:";

let catalogMap;

function parseMap() {
  const element = document.getElementById(MAP_ELEMENT_ID);
  if (!element) return;
  try {
    return JSON.parse(element.textContent ?? "");
  } catch {
    return;
  }
}

function readCatalogMap() {
  catalogMap ??= new Promise((resolve, reject) => {
    const finish = () => {
      const map = parseMap();
      if (map) resolve(map);
      else reject(new Error("The document has no Palamedes client catalog map."));
    };
    // The map is rendered in <head>, so it is usually parsed before any chunk
    // runs. An async chunk can still win that race; it then waits for the
    // parser instead of failing.
    const map = parseMap();
    if (map) resolve(map);
    else if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", finish, { once: true });
    else finish();
  });
  return catalogMap;
}

/** Loads the messages of one translated module for the document locale. */
export async function loadClientCatalog(marker) {
  const key = marker.slice(MARKER_PREFIX.length).split(":", 1)[0];
  const map = await readCatalogMap();
  const locale = document.documentElement.lang;
  if (map.locale !== locale) {
    throw new Error("The Palamedes client catalog map does not match the document locale.");
  }
  const url = Object.hasOwn(map.assets, key) ? map.assets[key] : undefined;
  if (url === undefined) {
    throw new Error(`The Palamedes client catalog map has no asset for module ${key}.`);
  }
  const fragment = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  return fragment.messages;
}
