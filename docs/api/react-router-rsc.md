# Migrating from `@palamedes/react-router-rsc`

The React Router RSC adapter is discontinued in Palamedes v2. React Router's
RSC mode is still experimental upstream, so no v2 package provides a React
Router RSC entry point. The 1.x package stays on npm, but it gets no further
releases and does not work with v2 packages.

Choose one of the paths in the
[v2 React Router RSC migration steps](../migration-v2.md#react-router-rsc):

- To keep React Router, move the application to Framework Mode without RSC and
  use [`@palamedes/react-router`](./react-router.md).
- To keep React Server Components, use Next.js with
  [`@palamedes/next-plugin`](./next-plugin.md) or Waku with
  [`@palamedes/waku`](./waku.md).

[ADR-026](../../adr/026-react-router-rsc-entry-request-scope.md) records the
decision.
