import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: ["./src/index", "./src/register"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
