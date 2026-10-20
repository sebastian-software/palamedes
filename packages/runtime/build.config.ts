import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/server",
    "./src/server-bundled",
    "./src/server-test",
    "./src/server-test-unavailable",
    "./src/server-unavailable",
    "./src/node-macros",
    "./src/node-macros-unavailable",
  ],
  declaration: true,
  externals: ["virtual:palamedes/server-catalogs"],
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
});
