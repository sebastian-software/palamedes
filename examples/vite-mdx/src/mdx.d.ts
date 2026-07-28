declare module "*.mdx" {
  import type { ComponentType } from "react"

  const MDXContent: ComponentType
  export default MDXContent
}

declare module "*.po" {
  import type { CatalogMessages } from "@palamedes/core"

  export const messages: CatalogMessages
}
