# Migrating from `@palamedes/eslint-plugin`

The ESLint/Oxlint adapter is removed from the Palamedes v2 release set. Use
[`pmds lint`](../cli.md#pmds-lint) for native source-authoring checks, including
explicit file checks for agent workflows:

```bash
pnpm exec pmds lint src/view.tsx --json --fail-on warning
```

Follow the [v2 lint migration steps](../migration-v2.md#replace-the-lint-adapter)
to remove host configuration, move severity settings into `palamedes.yaml`, and
convert suppression directives. The native analysis and Node binding remain
available. V2 does not provide a first-party editor adapter or LSP.
