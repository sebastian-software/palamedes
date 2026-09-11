import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/server"],
  declaration: true,
  externals: ["waku/router/server", "hono"],
  failOnWarn: false,
  rollup: {
    emitCJS: false,
  },
});
