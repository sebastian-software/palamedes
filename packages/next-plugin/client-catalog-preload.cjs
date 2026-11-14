"use strict";

/*
 * Node preload (`--require`) for `next build` with
 * experimentalClientCatalogPermutations. withPalamedes() adds it to
 * NODE_OPTIONS, which Next's prerender workers inherit; instrumentation.ts
 * does not run in those workers. It binds the locale resolver into the
 * manifests the post-compile step wrote. Processes that find none, such as
 * workers spawned before the compile, bind nothing; a render there fails
 * loudly on its first manifest read.
 */
const distDir = process.env.__PALAMEDES_NEXT_CATALOG_PERMUTATIONS_DIST;
if (distDir) {
  require("./dist/client-catalog-binding.cjs").bindClientCatalogPermutationsAt(distDir);
}
