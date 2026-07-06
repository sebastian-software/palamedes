# Remix v3 Cookie Example

This example proves the experimental Remix v3 integration without relying on a
Vite build.

It uses:

- `node --import remix/node-tsx`
- `node --import @palamedes/remix/register`
- `createRemixI18nRequestScope()` from `@palamedes/remix/server`
- Palamedes JS macros in server-rendered Remix code

Run it locally:

```sh
pnpm --filter @palamedes/example-remix-cookie build
pnpm --filter @palamedes/example-remix-cookie start
```

Then open <http://127.0.0.1:4060/>.
