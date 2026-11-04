import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/client-catalog-binding",
    "./src/proxy",
    "./src/server",
    "./src/server-catalogs",
    "./src/server-function-entry",
    "./src/server-function-initializer",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
});
