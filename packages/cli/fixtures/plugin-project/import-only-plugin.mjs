import { definePlugin } from "../../plugin-api.mjs"

export default definePlugin({
  name: "import-only",
  apiVersion: 1,
  commands: {
    ping: {
      run() {
        return "esm pong"
      },
    },
  },
})
