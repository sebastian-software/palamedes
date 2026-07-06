import { get, route } from "remix/routes"

export const routes = route({
  root: get("/"),
  home: get("/:locale"),
})
