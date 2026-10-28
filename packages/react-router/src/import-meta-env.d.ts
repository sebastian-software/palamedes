// Vite defines `import.meta.env` when it bundles the adapter into a server
// build or loads it in its development server. Plain Node leaves it undefined.
interface ImportMeta {
  readonly env?: { readonly DEV: boolean };
}
