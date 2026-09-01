import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/register",
    "./src/server",
    "./src/client",
    "./src/compiled",
    "./src/macro",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
  },
})
