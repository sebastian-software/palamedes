import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/client"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: false,
  },
});
