# `@palamedes/react-router-rsc`

`@palamedes/react-router-rsc` is the opt-in, experimental request-scope adapter
for React Router RSC Framework Mode Server Functions. See the package
[README](../../packages/react-router-rsc/README.md) for installation, the
custom `entry.rsc.tsx` setup, and runtime limitations.

## Exports

- `createReactRouterRscI18nRequestScope(resolveI18n)`
- `ReactRouterRscI18nResolver`
- `ReactRouterRscI18nRequestScope`

The request scope's `run(request, dispatch)` resolves and activates i18n before
calling `dispatch`. Resolver failures prevent dispatch and retain the original
error as the error cause.

Only React Router `8.3.0` RSC Framework Mode with `@vitejs/plugin-rsc`
`0.5.34` is supported. RSC Data Mode and non-RSC React Router applications are
out of scope.

`scope.run()` restores its caller after dispatch settles. Async resources
created inside the scope retain the request's `AsyncLocalStorage` store when
they run later; separately initiated work without an inherited context has no
active locale and must receive explicit data or a suitable new scope.
