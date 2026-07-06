# Remix v3 Cookie Example

This example proves the experimental Remix v3 integration without relying on a
Vite build.

It uses:

- `node --import remix/node-tsx`
- `node --import @palamedes/remix/register`
- `createRemixI18nServer()` from `@palamedes/remix/server`
- Palamedes JS macros in server-rendered Remix code
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
next render uses the matching catalog.
