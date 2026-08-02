declare module "*.po" {
  export const messages: import("@palamedes/core/compiled").CompiledCatalogMessages

  const catalog: {
    messages: import("@palamedes/core/compiled").CompiledCatalogMessages
  }

  export default catalog
}
