/**
 * Renderer helpers shared by the Palamedes framework packages.
 *
 * `@palamedes/core/internal` is an Internal surface (see the stability table).
 * The React, Solid and Remix `Trans` renderers use these helpers to build their
 * compiled message runtime and to format rich-text arguments the same way the
 * string runtime does. They change together with the renderers and the
 * generated catalog format; applications should not import them.
 *
 * @packageDocumentation
 */
export {
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
  type MessageFormat,
} from "./runtimeFormat";
export { createCompiledMessageRuntime, type ExecutableMessageRenderer } from "./compiledMessage";
