# @palamedes/react

Provider-free React components and macro entry points for Palamedes.

Use this package when your app wants JSX translation components such as `Trans` with Palamedes-owned React runtime behavior.

## Installation

```bash
pnpm add @palamedes/react
```

## Minimal Example

```tsx
import { Trans } from "@palamedes/react/macro"

export function Footer() {
  return (
    <footer>
      <Trans>Powered by Palamedes</Trans>
    </footer>
  )
}
```
