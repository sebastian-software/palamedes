import { createRouter } from "remix/router"

import controller from "./actions/controller.ts"
import { routes } from "./routes.ts"

export const router = createRouter()

router.map(routes, controller)
