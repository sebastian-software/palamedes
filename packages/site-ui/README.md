# `@palamedes/site-ui`

Shared React chrome and the Hellenic Spec Grid design contract for the
Palamedes sites.

## Consumer setup

Import the self-contained component CSS once:

```ts
import "@palamedes/site-ui/styles.css"
```

Tailwind v4 consumers additionally import
`@palamedes/site-ui/tailwind.css` before Tailwind itself. That optional export
contains all `@theme` and `@utility` declarations; the plain `styles.css`
export contains only standards-based CSS.

Wrap the site in `SiteUiProvider` when a framework router should own internal
navigation:

```tsx
import {
  SiteShell,
  SiteUiProvider,
  defineSiteConfig,
  type SiteLinkComponentProps,
} from "@palamedes/site-ui"
import { Link } from "react-router"

function RouterLink({ href, className, children, ariaLabel }: SiteLinkComponentProps) {
  return href.startsWith("/") ? (
    <Link to={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  )
}

const config = defineSiteConfig({
  name: "Palamedes+",
  homeHref: "/",
  navigation: [],
  footerColumns: [],
  counterpart: {
    label: "Palamedes OSS",
    href: "https://palamedes.dev",
    enabled: true,
  },
  copyright: "© Sebastian Software GmbH",
})

export function App() {
  return (
    <SiteUiProvider linkComponent={RouterLink}>
      <SiteShell config={config}>Content</SiteShell>
    </SiteUiProvider>
  )
}
```

The package has no React Router or ARDO dependency. A disabled `counterpart`
never renders in the shared header or footer.
