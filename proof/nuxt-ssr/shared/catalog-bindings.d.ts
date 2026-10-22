declare module "#palamedes/catalog-bindings" {
  import type { ViteCatalogBinding } from "@palamedes/vite-plugin/delivery";
  const bindings: Readonly<Record<string, ViteCatalogBinding>> | null;
  export default bindings;
}
