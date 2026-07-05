import {
  ArdoErrorBoundary,
  ArdoFooter,
  ArdoNav,
  ArdoNavLink,
  ArdoRoot,
  ArdoRootLayout,
  ArdoSocialLink,
} from "ardo/ui"
import "ardo/ui/styles.css"
import config from "virtual:ardo/config"
import sidebars from "virtual:ardo/sidebars"

import "./app.css"

export function Layout({ children }: { children: React.ReactNode }) {
  return <ArdoRootLayout>{children}</ArdoRootLayout>
}

export default function App() {
  return (
    <ArdoRoot
      config={config}
      sidebar={sidebars}
      contexts={[
        { id: "docs", label: "Docs", href: "/docs" },
        { id: "api-reference", label: "API", href: "/api-reference" },
        { id: "decisions", label: "Decisions", href: "/decisions" },
        { id: "blog", label: "Blog", href: "/blog", match: "/blog/" },
      ]}
      editLink={{
        pattern: "https://github.com/sebastian-software/palamedes/edit/main/:path",
        text: "Edit this page on GitHub",
      }}
      lastUpdated={{ enabled: true, text: "Last updated" }}
      headerProps={{
        logo: "/favicon.svg",
        searchPlaceholder: "Search Palamedes docs...",
        nav: (
          <ArdoNav>
            <ArdoNavLink to="/">Home</ArdoNavLink>
            <ArdoNavLink to="/frameworks">Frameworks</ArdoNavLink>
            <ArdoNavLink to="/proof">Proof</ArdoNavLink>
            <ArdoNavLink to="/get-started">Get started</ArdoNavLink>
            <ArdoNavLink to="/compare">Compare</ArdoNavLink>
            <ArdoNavLink to="/blog">Blog</ArdoNavLink>
            <ArdoNavLink to="/docs">Docs</ArdoNavLink>
          </ArdoNav>
        ),
        actions: (
          <ArdoSocialLink
            href="https://github.com/sebastian-software/palamedes"
            icon="github"
            ariaLabel="Palamedes on GitHub"
          />
        ),
      }}
      footer={
        <ArdoFooter
          sponsor={{ text: "Sebastian Software", link: "https://oss.sebastian-software.com/" }}
          message="Released under the MIT License."
          copyright="Copyright 2026 Sebastian Software GmbH"
        />
      }
    />
  )
}

export const ErrorBoundary = ArdoErrorBoundary
