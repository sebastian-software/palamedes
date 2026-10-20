/**
 * Alias kept for Vite-hosted adapters. Application code should import
 * `createBundledServerI18n` from `@palamedes/runtime/server/bundled`, so it
 * depends on the runtime rather than on a build-tool package.
 */
export {
  createBundledServerI18n as createViteServerI18n,
  type BundledServerI18nOptions as ViteServerI18nOptions,
} from "@palamedes/runtime/server/bundled";
