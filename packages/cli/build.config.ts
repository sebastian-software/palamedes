import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    "./src/index",
    { input: "./src/cli", name: "cli", builder: "rollup" },
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
    inlineDependencies: false,
  },
})
