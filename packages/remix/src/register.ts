import { registerHooks } from "node:module"

import { createPalamedesRemixLoadHook } from "./index"

registerHooks({
  load: createPalamedesRemixLoadHook(),
})
