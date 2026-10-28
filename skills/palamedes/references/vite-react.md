# Vite with React in the browser

Use this route for a browser React app with the compiled adapter contract.
Preserve the existing Vite/React versions and plugins; check the target's peer
dependencies and Node/native platform requirements. This recipe is TSX, not
Vite SSR or an MDX integration. Install compatible `@palamedes/core`,
`@palamedes/react`, `@palamedes/runtime`, and `@palamedes/vite-plugin`, plus
development dependencies `@palamedes/cli` and `@palamedes/config` with the
project's package manager. Do not reinstall or upgrade existing host packages
as an incidental part of the setup.

## Configuration

Merge the plugin into the existing configuration and keep other options:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes(), react()],
});
```

```yaml
# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Adapt locales, includes, exclusions, and paths to the app. The plugin derives
and awaits compiled fragments before translated modules execute. Remove old
application-owned catalog maps, runtime activation, and manual `.po` imports
after migration checkpoints pass. Do not replace them with a client boundary.

## Document locale and authoring

The host must set `<html lang>` to its validated locale **before** loading the
module entry. For a static first translation, change the existing opening
`<html>` tag to `lang="de"`; preserve the rest of `index.html`. For an app that
negotiates a cookie or route, keep that policy in its document/host layer. A
post-mount React effect is too late to initialize the entry's locale.

```tsx
// src/App.tsx
import { Trans } from "@palamedes/react/macro";

export default function App() {
  return (
    <h1>
      <Trans>Welcome to Palamedes</Trans>
    </h1>
  );
}
```

Keep the app's existing root mounting convention and any router/providers.
After extraction, translate the German PO entry to `Willkommen bei Palamedes`.

## Verify

Run the real extraction, type checks, tests, and Vite production build. Serve
the build and assert the rendered heading with both `lang="en"` and
`lang="de"` supplied before entry evaluation. Changing the document locale
requires full document navigation; mutating `lang` after module evaluation is
not a live runtime switch. Verify persistence against a real saved preference
when a switcher exists; initialization and read-only checks must not save it.

Keep existing host recovery UI, and test a failed required fragment where the
app has a recovery boundary. A catalog failure may occur before the translated
module loads; an error boundary inside that same module cannot handle its own
import failure. Recovery must be outside the dependent module and offer a full
reload. Never turn a rejected import into an empty catalog or success output.

Consult the **target version's** Vite plugin docs and
[first-run guide](https://palamedes.dev/docs/first-working-translation) for
additional options. Confirm public docs match the installed target.
