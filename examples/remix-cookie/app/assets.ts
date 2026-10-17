import path from "node:path";

import { createPalamedesRemixAssetLoader, PALAMEDES_REMIX_ASSET_PACKAGES } from "@palamedes/remix";
import { createAssetServer } from "remix/assets";

import { catalogAssetRegistry } from "./i18n.ts";

export const assetServer = createAssetServer({
  rootDir: path.resolve(import.meta.dirname, ".."),
  basePath: "/assets",
  mounts: {
    app: "app",
    npm: "node_modules",
    vendor: "../../node_modules",
    workspace: "../../packages",
  },
  allowFiles: ["app/**/public/**"],
  allowPackages: ["remix", ...PALAMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: { loaders: [createPalamedesRemixAssetLoader({ catalogAssets: catalogAssetRegistry })] },
});
