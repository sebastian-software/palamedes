import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes(
  {},
  // `build:catalog-assets` builds the experimental out-of-graph delivery.
  { experimentalClientCatalogAssets: process.env.PALAMEDES_NEXT_CATALOG_ASSETS === "1" },
);
