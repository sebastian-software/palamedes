import { get, post, route } from "remix/routes";

export const routes = route({
  home: get("/"),
  serverStatus: get("/server-status"),
  frameDocument: get("/frames"),
  frameLocaleSummary: get("/frames/locale-summary"),
  setLocale: post("/locale"),
});
