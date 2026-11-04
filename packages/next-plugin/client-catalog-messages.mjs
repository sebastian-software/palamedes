// Permutation delivery (experimentalClientCatalogPermutations): the transform
// loader passes the module's marker literal through this function, and the
// post-compile step replaces the literal with the locale's compiled messages
// in each locale copy of the chunk. Only a locale-neutral chunk still carries
// the string. The server never references neutral chunks for a supported
// request, so this means another process served the document than the one
// that selects chunks, or a locale switch happened without a document
// navigation.
const MARKER_PREFIX = "pmds-next:";

function moduleName(marker) {
  try {
    const payload = marker.split(":")[2];
    const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)).source ?? marker;
  } catch {
    return marker;
  }
}

/** Returns the compiled messages the build inlined for this module. */
export function clientCatalogMessages(value) {
  if (typeof value === "string" && value.startsWith(MARKER_PREFIX)) {
    throw new Error(
      `Palamedes loaded a locale-neutral client chunk for ${moduleName(value)}. The server did not select this locale's chunk copy: bind the permutations in every rendering process and make locale switches full document navigations.`,
    );
  }
  return value;
}
