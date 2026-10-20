import { get, post, route } from "remix/routes";

export const routes = route({
  root: get("/"),
  home: get("/:locale"),
  serverStatus: get("/:locale/server-status"),
  frameDocument: get("/:locale/frames"),
  frameLocaleSummary: get("/:locale/frames/locale-summary"),
  setLocale: post("/locale"),
});
