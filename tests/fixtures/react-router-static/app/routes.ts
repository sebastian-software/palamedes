import { index, route } from "@react-router/dev/routes";
export default [index("routes/index.tsx"), route(":locale", "routes/home.tsx")];
