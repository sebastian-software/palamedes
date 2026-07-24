import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/index-server",
    "./src/client",
    "./src/runtime",
    "./src/runtime-server",
    "./src/macro",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
    output: {
      banner: (chunk) =>
        chunk.name === "index" || chunk.name === "runtime" ? '"use client";' : "",
    },
  },
})
