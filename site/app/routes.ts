import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("frameworks", "routes/frameworks.tsx"),
  route("proof", "routes/proof.tsx"),
  route("get-started", "routes/get-started.tsx"),
  route("compare", "routes/compare.tsx"),
  route("blog", "routes/blog.tsx"),
] satisfies RouteConfig
