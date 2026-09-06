// Bridge for the `@sebastian-software/standards` seed. The repository's ESLint
// configuration lives in eslint.config.mjs, which ESLint resolves ahead of this
// file; re-exporting keeps a single source of truth for both entry points.
export { default } from "./eslint.config.mjs";
