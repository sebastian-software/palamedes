/// <reference types="@vitejs/plugin-rsc/types" />
/// <reference types="@react-router/dev/rsc-types" />

declare module "*.po" {
  export const messages: import("@palamedes/core/compiled").CompiledCatalogMessages
  const catalog: {
    messages: import("@palamedes/core/compiled").CompiledCatalogMessages
  }
  export default catalog
}

declare module "server-only" {}
