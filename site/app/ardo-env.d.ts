declare module "*.md" {
  import type { FunctionComponent } from "ardo/react";

  const Component: FunctionComponent;
  export default Component;
}

declare module "*.mdx" {
  import type { FunctionComponent } from "ardo/react";

  const Component: FunctionComponent;
  export default Component;
}

declare const __PALAMEDES_BUILD_HASH__: string;
