import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index", "./src/react-router", "./src/react-router-client"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
});
