import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/delivery"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
});
