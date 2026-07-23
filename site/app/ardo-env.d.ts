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
