import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes(
  // `build:catalog-assets` builds a standalone server so the deploy check can
  // run the build away from the project directory.
  process.env.PALAMEDES_NEXT_STANDALONE === "1" ? { output: "standalone" } : {},
  // `build:catalog-assets` builds the experimental out-of-graph delivery.
  { experimentalClientCatalogAssets: process.env.PALAMEDES_NEXT_CATALOG_ASSETS === "1" },
);
