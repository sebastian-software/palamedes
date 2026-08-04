import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    "./src/index-server",
    "./src/compiled",
    "./src/compiled-server",
    "./src/client",
    "./src/macro",
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
    output: {
      banner: (chunk) =>
        chunk.name === "index" || chunk.name === "compiled" ? '"use client";' : "",
    },
  },
})
