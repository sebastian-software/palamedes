# Node Runtime Macros

A booking CLI and a `node:http` service that use the `t` and `plural` macros
without a bundler. The same source runs with plain `node` type stripping and
as plain `tsc` output; there is no load hook and no source preprocessing.

```bash
pnpm i18n                     # write .palamedes/macros.json and .palamedes/catalogs/*.mjs
node src/cli.ts show BK-1 --locale de
pnpm build && node dist/cli.js show BK-1 --locale es
PORT=3000 node src/server.ts  # Accept-Language selects en, de, or es
```

`src/i18n.ts` is the whole integration: it registers the runtime macro
manifest and loads the compiled catalog for a locale. The CLI picks its locale
from `--locale`, then `LC_ALL`, `LC_MESSAGES`, and `LANG`. `--json` prints a
stable result, and the exit codes are `0` (found), `1` (not found), and `2`
(invalid arguments).

`pnpm test` covers both execution modes, concurrent HTTP requests, a deployed
copy without sources or the CLI, a missing catalog, unregistered macros, and
the extraction guards for runtime collisions and nested macros.
