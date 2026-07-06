import { createRouter } from "remix/router"

import controller from "./actions/controller.ts"
import { routes } from "./routes.ts"

export const router = createRouter()

// oxlint-disable-next-line unicorn/no-array-method-this-argument -- Remix router.map() is not Array.prototype.map().
router.map(routes, controller)
