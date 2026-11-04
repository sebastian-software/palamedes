import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes(
  // `build:catalog-assets` builds a standalone server so the deploy check can
  // run the build away from the project directory.
  process.env.PALAMEDES_NEXT_STANDALONE === "1" ? { output: "standalone" } : {},
  // This example and its hosted demo run the experimental out-of-graph
  // delivery; `build:graph` builds the default in-graph catalogs instead.
  { experimentalClientCatalogAssets: process.env.PALAMEDES_NEXT_CATALOG_ASSETS !== "0" },
);
