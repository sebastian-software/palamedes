declare module "*.po" {
  export const messages: import("@palamedes/core/compiled").CompiledCatalogMessages;
  const catalog: {
    messages: import("@palamedes/core/compiled").CompiledCatalogMessages;
  };
  export default catalog;
}

declare module "virtual:palamedes/server-catalogs" {
  export function loadServerCatalog(
    locale: string,
  ): Promise<import("@palamedes/core/compiled").CompiledCatalogMessages>;
}
