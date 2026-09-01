# Remix v3 Cookie Example

This example proves the full Remix v3 server-and-browser integration without
relying on a Vite build.

It uses:

- `node --import remix/node-tsx`
- `node --import @palamedes/remix/register`
- `createRemixI18nServer()` from `@palamedes/remix/server`
- Palamedes JS macros in server-rendered Remix code
- Remix's asset server with the Palamedes post-compile browser loader
- an inert, server-selected browser catalog compiled from the same `.po` files
- a server-rendered Remix UI island with rich messages, plurals, selects, and
  browser interaction
- cookie locale negotiation with `defineLocaleControls()`
- per-request catalog loading before translated code renders

Run it locally:

```sh
pnpm --filter @palamedes/example-remix-cookie build
pnpm --filter @palamedes/example-remix-cookie start
```

Then open <http://127.0.0.1:4060/>.

The app renders from `Accept-Language` on the first request. Submit one of the
locale buttons to POST `/locale`; the response sets a `locale` cookie and the
full document navigation returns matching server HTML and browser bootstrap
data. The browser never imports a `.po` file.
