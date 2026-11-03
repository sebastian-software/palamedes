import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes(
  {},
  { experimentalClientCatalogAssets: process.env.PALAMEDES_NEXT_CATALOG_ASSETS === "1" },
);
