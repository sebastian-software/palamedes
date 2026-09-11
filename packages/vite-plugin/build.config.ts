import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/react-router", "./src/delivery", "./src/server"],
  declaration: true,
  externals: ["virtual:palamedes/server-catalogs"],
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
});
