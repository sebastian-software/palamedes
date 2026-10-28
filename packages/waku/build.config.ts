import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/server"],
  declaration: true,
  externals: ["waku/router/server"],
  failOnWarn: false,
  rollup: {
    emitCJS: false,
  },
});
