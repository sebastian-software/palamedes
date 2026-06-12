import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: ["./src/index", "./src/catalogLoader"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
