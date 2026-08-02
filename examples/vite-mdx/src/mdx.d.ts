declare module "*.mdx" {
  import type { ComponentType } from "react"

  const MDXContent: ComponentType
  export default MDXContent
}

declare module "*.po" {
  import type { CompiledCatalogMessages } from "@palamedes/core/compiled"

  export const messages: CompiledCatalogMessages
}
