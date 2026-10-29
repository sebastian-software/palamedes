import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { writeRedirectPages } from "./redirect-pages.mjs";

/*
 * `site/api-reference-redirects.json` keeps API reference URLs that were
 * already public working after the generator changes its layout:
 *
 * - `legacyRoutes` is every `/api-reference` route the published 1.x site
 *   listed in its sitemap. Treat it as append-only history.
 * - `redirects` maps each legacy route that the current generator no longer
 *   emits to the page that replaced it, or to the package's API index when a
 *   symbol has no direct successor.
 */
export function validateApiReferenceRedirects({ legacyRoutes, redirects }, currentRoutes) {
  if (!Array.isArray(legacyRoutes) || !redirects || typeof redirects !== "object") {
    throw new Error("API reference redirects need `legacyRoutes` and `redirects`");
  }
  const current = new Set(currentRoutes);
  const legacy = new Set(legacyRoutes);
  const missing = legacyRoutes.filter((route) => !current.has(route) && !(route in redirects));
  if (missing.length > 0) {
    throw new Error(
      `Published API reference routes have neither a page nor a redirect:\n${missing.join("\n")}`,
    );
  }
  for (const [source, target] of Object.entries(redirects)) {
    if (!legacy.has(source)) {
      throw new Error(`API reference redirect source is not a published route: ${source}`);
    }
    if (current.has(source)) {
      throw new Error(`API reference redirect shadows a current page: ${source}`);
    }
    if (!current.has(target)) {
      throw new Error(`API reference redirect must target a current page: ${source} -> ${target}`);
    }
  }
}

export async function apiReferenceRoutes(routesRoot) {
  const entries = await readdir(join(routesRoot, "api-reference"), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) =>
      `/${relative(routesRoot, join(entry.parentPath, entry.name))
        .replaceAll("\\", "/")
        .replace(/\.md$/u, "")
        .replace(/(^|\/)index$/u, "")}`.replace(/\/$/u, ""),
    )
    .sort();
}

export async function writeApiReferenceRedirects(siteRoot, routesRoot, publicRoot) {
  const config = JSON.parse(await readFile(join(siteRoot, "api-reference-redirects.json"), "utf8"));
  validateApiReferenceRedirects(config, await apiReferenceRoutes(routesRoot));
  await writeRedirectPages(publicRoot, "api-reference", config.redirects, {
    title: "API reference moved",
    message: "This API reference page has moved.",
    linkText: "Open the current page",
  });
}
