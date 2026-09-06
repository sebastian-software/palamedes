// Bridge for the `@sebastian-software/standards` seed. The repository's Oxlint
// rules live in .oxlintrc.json, which `pnpm lint:oxlint` passes explicitly;
// re-exporting keeps a single source of truth for both entry points.
import { defineConfig } from "oxlint"

import config from "./.oxlintrc.json" with { type: "json" }

export default defineConfig(config)
