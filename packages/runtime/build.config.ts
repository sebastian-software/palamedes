import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/server",
    "./src/server-test",
    "./src/server-test-unavailable",
    "./src/server-unavailable",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
