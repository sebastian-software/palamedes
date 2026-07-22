import { definePlugin } from "../../plugin-api.mjs"

export default definePlugin({
  name: "example",
  apiVersion: 1,
  commands: {
    inspect: {
      description: "Inspect the resolved Palamedes project.",
      run({ args, options, host }) {
        return {
          text: `${options.greeting} from ${host.config.rootDir}`,
          data: {
            args,
            catalogs: host.catalogs(),
          },
        }
      },
    },
  },
})
