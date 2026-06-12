import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: ["./src/index", "./src/server"],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
