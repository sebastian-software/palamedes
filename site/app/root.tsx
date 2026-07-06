import {
  ArdoErrorBoundary,
  ArdoNav,
  ArdoNavLink,
  ArdoRoot,
  ArdoRootLayout,
  ArdoSidebar,
  ArdoSocialLink,
} from "ardo/ui"
import config from "virtual:ardo/config"
import sidebars from "virtual:ardo/sidebars"

import { ButtonLink } from "~/components/chrome/Button"
import { SiteFooter } from "~/components/chrome/SiteFooter"

import "./app.css"

export function Layout({ children }: { children: React.ReactNode }) {
  return <ArdoRootLayout>{children}</ArdoRootLayout>
}

/*
 * ARDO owns the chrome: its header and footer render on every route (marketing
 * pages included), so nothing below <ArdoRoot> may add a second nav or footer.
 * Palamedes look and feel comes from the --ardo-* token bridge in app.css plus
 * the public props used here — never from overriding ARDO internals.
 */
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
        /* Light-only site by design ("Swiss Spec Grid" is a paper spec sheet);
         * re-enable once both token systems ship a dark set. */
        themeToggle: false,
        nav: (
          <ArdoNav>
            <ArdoNavLink className="pmds-nav-link" to="/frameworks">
              Frameworks
            </ArdoNavLink>
            <ArdoNavLink className="pmds-nav-link" to="/proof">
              Proof
            </ArdoNavLink>
            <ArdoNavLink className="pmds-nav-link" to="/compare">
              Compare
            </ArdoNavLink>
            <ArdoNavLink className="pmds-nav-link" to="/blog">
              Blog
            </ArdoNavLink>
            <ArdoNavLink className="pmds-nav-link" to="/docs">
              Docs
            </ArdoNavLink>
          </ArdoNav>
        ),
        /* Always provide mobile-menu content: without it ARDO skips the
         * hamburger and marketing pages would lose their nav below 1024px.
         * The zero-config <ArdoSidebar> resolves the active context's items
         * (empty on marketing routes — the panel still shows the nav links).
         * The CTA lives here too because the header hides it below 560px. */
        mobileMenuContent: (
          <>
            <div className="px-4 pb-4">
              <ButtonLink variant="primary" href="/get-started" className="w-full text-center">
                Get started
              </ButtonLink>
            </div>
            <ArdoSidebar />
          </>
        ),
        actions: (
          <>
            <ArdoSocialLink
              href="https://github.com/sebastian-software/palamedes"
              icon="github"
              ariaLabel="Palamedes on GitHub"
            />
            <ButtonLink variant="small" href="/get-started" className="max-tight:hidden">
              Get started
            </ButtonLink>
          </>
        ),
      }}
      footer={
        <div className="frame border-t-0">
          <SiteFooter />
        </div>
      }
    />
  )
}

export const ErrorBoundary = ArdoErrorBoundary
