import path from "node:path";

import { Config } from "@remotion/cli/config";

// snapcn components import through the `@/` alias; Remotion's bundler does not
// read tsconfig paths, so the alias is declared here as well.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...config.resolve?.alias, "@": path.join(process.cwd(), "src") },
  },
}));
