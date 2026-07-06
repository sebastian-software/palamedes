import { get, post, route } from "remix/routes"

export const routes = route({
  home: get("/"),
  setLocale: post("/locale"),
})
