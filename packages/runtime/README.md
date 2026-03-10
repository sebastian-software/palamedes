# @palamedes/runtime

Runtime primitives for Palamedes-transformed code.

## API

- `getI18n()`: return the active i18n instance or throw
- `setClientI18n(i18n)`: register the active client instance
- `setServerI18nGetter(getter)`: resolve the active server instance on demand
