# Vite MDX example

A deliberately small client-side documentation application proving Palamedes'
first-class MDX workflow end to end:

- three linked `.mdx` pages
- native extraction and Vite compilation through the same semantic pipeline
- React components, rich text, expressions, translated attributes, image alt
  text, and fenced code
- English and German catalogs switched at runtime without a reload

Run `pnpm --filter @palamedes/example-vite-mdx dev` or verify the production
build and browser behavior through
`pnpm verify:examples -- --id vite-mdx`.
