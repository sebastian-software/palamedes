# Demo Deployments

Palamedes publishes the example matrix through `Vercel`, but the builds run in
`GitHub Actions`, not on Vercel.

## Deployment Model

- 8 separate `Vercel` projects, one per example app
- default public hosts stay on `*.vercel.app` in phase 1
- production deploys run on `push` to `main`
- preview deploys run only through manual `workflow_dispatch`
- Vercel Git deployments must stay disabled for these projects

The canonical deployment metadata lives in:

- [scripts/example-matrix.mjs](/Users/sebastian/Workspace/business/palamedes/scripts/example-matrix.mjs)

## Vercel Projects

| Example | Project | Default host |
| --- | --- | --- |
| `nextjs-cookie` | `palamedes-nextjs-cookie` | [palamedes-nextjs-cookie.vercel.app](https://palamedes-nextjs-cookie.vercel.app) |
| `nextjs-route` | `palamedes-nextjs-route` | [palamedes-nextjs-route.vercel.app](https://palamedes-nextjs-route.vercel.app) |
| `tanstack-cookie` | `palamedes-tanstack-cookie` | [palamedes-tanstack-cookie.vercel.app](https://palamedes-tanstack-cookie.vercel.app) |
| `tanstack-route` | `palamedes-tanstack-route` | [palamedes-tanstack-route.vercel.app](https://palamedes-tanstack-route.vercel.app) |
| `waku-cookie` | `palamedes-waku-cookie` | [palamedes-waku-cookie.vercel.app](https://palamedes-waku-cookie.vercel.app) |
| `waku-route` | `palamedes-waku-route` | [palamedes-waku-route.vercel.app](https://palamedes-waku-route.vercel.app) |
| `react-router-cookie` | `palamedes-reactrouter-cookie` | [palamedes-reactrouter-cookie.vercel.app](https://palamedes-reactrouter-cookie.vercel.app) |
| `react-router-route` | `palamedes-reactrouter-route` | [palamedes-reactrouter-route.vercel.app](https://palamedes-reactrouter-route.vercel.app) |

## One-Time Setup

For each project in `Vercel`:

1. Create a separate project with the exact project name from the table above.
2. Point the project root at the matching example directory under `examples/`.
3. Disable Vercel Git deployments for the project.
4. Keep the default `vercel.app` domain in phase 1.

Repository setup in `GitHub`:

- add `VERCEL_TOKEN`
- optionally add `VERCEL_SCOPE` as a repo or environment variable if the token can access multiple Vercel scopes

Preferred repository setup:

- run `vercel link --yes --project <project-name>` once inside each example directory
- commit the resulting `examples/<app>/.vercel/project.json` if you want the link to stay explicit in the repo
- if the file is not committed, the deploy helper links the project by name at runtime

The deploy helper uses the matrix project names as the source of truth, so no
repo-wide JSON mapping secret is required anymore.

## Workflow Shape

The deployment workflow lives at:

- [deploy-examples.yml](/Users/sebastian/Workspace/business/palamedes/.github/workflows/deploy-examples.yml)

It runs in three stages:

1. target selection from the example matrix
2. full example verification with `pnpm verify:examples`
3. per-example deployment with:

```bash
vercel pull --yes --environment=<preview|production>
vercel build
vercel deploy --prebuilt
```

The actual repository-side deploy helper is:

- [deploy-examples.mjs](/Users/sebastian/Workspace/business/palamedes/scripts/deploy-examples.mjs)

## Local Dry Run

The deploy helper supports selection filters and a dry-run mode:

```bash
pnpm deploy:examples -- --dry-run --id nextjs-cookie --environment preview
pnpm deploy:examples -- --dry-run --framework waku
```

To materialize the committed Vercel link file for one example:

```bash
cd examples/nextjs-cookie
pnpm exec vercel link --yes --project palamedes-nextjs-cookie
```

## Future Phase

Phase 2 can replace the `vercel.app` hosts with project-specific subdomains, but
that is intentionally outside the first rollout. The phase-1 priority is to
make the full example matrix public without paying for Vercel-side builds.
