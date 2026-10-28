/**
 * Renderer helpers shared by the Palamedes framework packages.
 *
 * `@palamedes/core/internal` is an Internal surface (see the stability table).
 * The React, Solid and Remix `Trans` renderers use these helpers to format
 * rich-text arguments the same way the string runtime does. They change
 * together with the renderers; applications should not import them.
 *
 * @packageDocumentation
 */
export {
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
  type MessageFormat,
} from "./runtimeFormat";
