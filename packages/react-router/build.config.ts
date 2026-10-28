import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/document"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: false,
  },
});
