# Example Screenshots

These screenshots are generated from the same Playwright-based browser verifier
used by the example matrix. They are versioned verification artifacts, not
manually curated mockups.

Refresh them with:

```bash
pnpm capture:example-screenshots
```

Each example has two screenshots. They are intentionally captured in two
different locales — that language change is the expected outcome of the
verification flow, **not** a hydration glitch or a discarded server render:

- **Initial**: the server-rendered state on first load, in **English**.
- **Interactive**: the same page in **German**, captured after the verifier
  clicks the locale switch and runs the localized server interaction. For the
  cookie strategy the choice is persisted and the server re-renders in German
  (a real server round-trip); for route, subdomain, and tld strategies it is a
  navigation to the localized path or host. In every case the switch is asserted
  to apply without hydration errors and without throwing away the server render.

## Next.js

### Cookie strategy

| Initial | Interactive |
| --- | --- |
| ![Next.js cookie – initial](./nextjs-cookie-initial.png) | ![Next.js cookie – interactive](./nextjs-cookie-interactive.png) |

### Route strategy

| Initial | Interactive |
| --- | --- |
| ![Next.js route – initial](./nextjs-route-initial.png) | ![Next.js route – interactive](./nextjs-route-interactive.png) |

### Subdomain strategy

| Initial | Interactive |
| --- | --- |
| ![Next.js subdomain – initial](./nextjs-subdomain-initial.png) | ![Next.js subdomain – interactive](./nextjs-subdomain-interactive.png) |

### TLD strategy

| Initial | Interactive |
| --- | --- |
| ![Next.js tld – initial](./nextjs-tld-initial.png) | ![Next.js tld – interactive](./nextjs-tld-interactive.png) |

## TanStack Start

### Cookie strategy

| Initial | Interactive |
| --- | --- |
| ![TanStack cookie – initial](./tanstack-cookie-initial.png) | ![TanStack cookie – interactive](./tanstack-cookie-interactive.png) |

### Route strategy

| Initial | Interactive |
| --- | --- |
| ![TanStack route – initial](./tanstack-route-initial.png) | ![TanStack route – interactive](./tanstack-route-interactive.png) |

### Subdomain strategy

| Initial | Interactive |
| --- | --- |
| ![TanStack subdomain – initial](./tanstack-subdomain-initial.png) | ![TanStack subdomain – interactive](./tanstack-subdomain-interactive.png) |

### TLD strategy

| Initial | Interactive |
| --- | --- |
| ![TanStack tld – initial](./tanstack-tld-initial.png) | ![TanStack tld – interactive](./tanstack-tld-interactive.png) |

## SolidStart

### Cookie strategy

| Initial | Interactive |
| --- | --- |
| ![SolidStart cookie – initial](./solidstart-cookie-initial.png) | ![SolidStart cookie – interactive](./solidstart-cookie-interactive.png) |

### Route strategy

| Initial | Interactive |
| --- | --- |
| ![SolidStart route – initial](./solidstart-route-initial.png) | ![SolidStart route – interactive](./solidstart-route-interactive.png) |

### Subdomain strategy

| Initial | Interactive |
| --- | --- |
| ![SolidStart subdomain – initial](./solidstart-subdomain-initial.png) | ![SolidStart subdomain – interactive](./solidstart-subdomain-interactive.png) |

### TLD strategy

| Initial | Interactive |
| --- | --- |
| ![SolidStart tld – initial](./solidstart-tld-initial.png) | ![SolidStart tld – interactive](./solidstart-tld-interactive.png) |

## Waku

### Cookie strategy

| Initial | Interactive |
| --- | --- |
| ![Waku cookie – initial](./waku-cookie-initial.png) | ![Waku cookie – interactive](./waku-cookie-interactive.png) |

### Route strategy

| Initial | Interactive |
| --- | --- |
| ![Waku route – initial](./waku-route-initial.png) | ![Waku route – interactive](./waku-route-interactive.png) |

### Subdomain strategy

| Initial | Interactive |
| --- | --- |
| ![Waku subdomain – initial](./waku-subdomain-initial.png) | ![Waku subdomain – interactive](./waku-subdomain-interactive.png) |

### TLD strategy

| Initial | Interactive |
| --- | --- |
| ![Waku tld – initial](./waku-tld-initial.png) | ![Waku tld – interactive](./waku-tld-interactive.png) |

## React Router

### Cookie strategy

| Initial | Interactive |
| --- | --- |
| ![React Router cookie – initial](./react-router-cookie-initial.png) | ![React Router cookie – interactive](./react-router-cookie-interactive.png) |

### Route strategy

| Initial | Interactive |
| --- | --- |
| ![React Router route – initial](./react-router-route-initial.png) | ![React Router route – interactive](./react-router-route-interactive.png) |

### Subdomain strategy

| Initial | Interactive |
| --- | --- |
| ![React Router subdomain – initial](./react-router-subdomain-initial.png) | ![React Router subdomain – interactive](./react-router-subdomain-interactive.png) |

### TLD strategy

| Initial | Interactive |
| --- | --- |
| ![React Router tld – initial](./react-router-tld-initial.png) | ![React Router tld – interactive](./react-router-tld-interactive.png) |
