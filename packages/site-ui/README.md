# `@palamedes/site-ui`

Shared React chrome and the Hellenic Spec Grid design contract for the
Palamedes sites.

## Consumer setup

Import the self-contained component CSS once:

```ts
import "@palamedes/site-ui/styles.css";
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
} from "@palamedes/site-ui";
import { Link } from "react-router";

function RouterLink({ href, className, children, ariaLabel }: SiteLinkComponentProps) {
  return href.startsWith("/") ? (
    <Link to={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
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
});

export function App() {
  return (
    <SiteUiProvider linkComponent={RouterLink}>
      <SiteShell config={config}>Content</SiteShell>
    </SiteUiProvider>
  );
}
```

The package has no React Router or ARDO dependency. A disabled `counterpart`
never renders in the shared header or footer.

## Family surfaces

`toolSwitcher` and `familyLine` are optional configuration. Set them and the
shared header renders a `<details>` tool switcher and the shared footer renders
a one-line family credit; leave them unset — as Palamedes+ does — and neither
appears in the markup at all.

Both are plain data. This package never reads the Ferramenta registry itself:
the consuming site resolves names, jobs, and destinations from
`@ferramenta/family/registry` and passes the result in, which is what keeps the
React-only dependency contract of ADR-021 intact.

```tsx
import { familyGroups } from "@ferramenta/family/registry";

const { pipeline, language, workbench } = familyGroups();

const config = defineSiteConfig({
  // ...
  toolSwitcher: {
    label: "Tools",
    ariaLabel: "Ferramenta family tools",
    groups: [
      {
        label: "Pipeline",
        tools: pipeline.map((tool) => ({
          label: tool.name,
          href: tool.docs ?? tool.repo,
          job: tool.shortJob,
          current: tool.name === "palamedes",
        })),
      },
    ],
  },
  familyLine: { label: "Ferramenta family", href: "https://ferramenta.dev", tools: [] },
});
```

`ToolSwitcher` and `FamilyLine` are exported on their own for a site whose
header is not `SiteHeader` — palamedes.dev drops `ToolSwitcher` into ARDO's
header actions.

`current: true` marks the entry with `aria-current="page"`. Consumer link
adapters receive that as the optional `ariaCurrent` prop; an adapter that
ignores it still satisfies `SiteLinkComponentProps`.
