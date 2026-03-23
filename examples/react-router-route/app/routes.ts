import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/root-redirect.tsx"),
  route(":locale", "routes/locale-home.tsx"),
] satisfies RouteConfig;
