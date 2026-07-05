declare module "*.md" {
  import type { FunctionComponent } from "react"

  const Component: FunctionComponent
  export default Component
}

declare module "virtual:ardo/config" {
  import type { ArdoConfig } from "ardo"

  const config: ArdoConfig
  export default config
}

declare module "virtual:ardo/sidebars" {
  import type { SidebarItem } from "ardo"

  const sidebars: Record<string, SidebarItem[]>
  export default sidebars
}
