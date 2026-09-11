import type { CompiledCatalogMessages } from "@palamedes/core";

/** Replaced by the adapter's watched catalog-generation loader. @internal */
export async function loadServerCatalog(_locale: string): Promise<CompiledCatalogMessages> {
  throw new Error(
    "Palamedes server catalog delivery is unavailable. Configure withPalamedes() before creating request i18n.",
  );
}
