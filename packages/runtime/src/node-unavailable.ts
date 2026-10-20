import type { CreateNodeI18n, NodeI18nSetup } from "./node";

export type { CreateNodeI18n, NodeI18nOptions, NodeI18nSetup } from "./node";

export function defineNodeI18n(_setup: NodeI18nSetup): CreateNodeI18n {
  throw new Error(
    "@palamedes/runtime/node is only available in Node.js. Build server code with a Palamedes plugin, which resolves it to the bundled catalog store.",
  );
}
