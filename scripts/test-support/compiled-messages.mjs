import { runInNewContext } from "node:vm";
import { renderCatalogModule } from "../../packages/core-node/dist/index.mjs";

/** Test-only evaluation of the canonical native generator's executable output. */
export function compileTestMessages(patterns) {
  const code = renderCatalogModule(patterns)
    .replace(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";',
      "",
    )
    .replace("export const messages=", "const messages=")
    .replace("export default { messages };", "messages;");
  return runInNewContext(code, { __palamedesDefineCompiledCatalog: (messages) => messages });
}
