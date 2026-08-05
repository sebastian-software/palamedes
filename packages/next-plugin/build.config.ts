import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/server",
    "./src/server-function-entry",
    "./src/server-function-initializer",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
