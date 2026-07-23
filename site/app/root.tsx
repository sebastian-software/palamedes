import {
  ArdoErrorBoundary,
  ArdoFooter,
  ArdoGeneratedSidebar,
  ArdoHeader,
  ArdoHeaderActions,
  ArdoNav,
  ArdoNavLink,
  ArdoRoot,
  ArdoRootLayout,
  ArdoSidebar,
  ArdoSidebarSection,
  ArdoSocialLink,
} from "ardo/ui"
import config from "virtual:ardo/config"

import { ButtonLink } from "~/components/chrome/Button"
import { SiteFooter } from "~/components/chrome/SiteFooter"

import "./app.css"

export function links() {
  return [
    {
      rel: "preload",
      href: "/fonts/CinzelHellenic-Regular.woff2",
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous" as const,
    },
  ]
}

export function Layout({ children }: { children: React.ReactNode }) {
  return <ArdoRootLayout>{children}</ArdoRootLayout>
}

function renderSidebarSections() {
  return (
    <>
      <ArdoSidebarSection id="docs" label="Docs" to="/docs">
        <ArdoGeneratedSidebar section="docs" />
      </ArdoSidebarSection>
      <ArdoSidebarSection id="api-reference" label="API" to="/api-reference">
        <ArdoGeneratedSidebar section="api-reference" />
      </ArdoSidebarSection>
      <ArdoSidebarSection id="decisions" label="Decisions" to="/decisions">
        <ArdoGeneratedSidebar section="decisions" />
      </ArdoSidebarSection>
      <ArdoSidebarSection id="blog" label="Blog" to="/blog" match="/blog/">
        <ArdoGeneratedSidebar section="blog" />
      </ArdoSidebarSection>
    </>
  )
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
      editLink={{
        pattern: "https://github.com/sebastian-software/palamedes/edit/main/:path",
        text: "Edit this page on GitHub",
      }}
      lastUpdated={{ enabled: true, text: "Last updated" }}
    >
      <ArdoHeader
        logo="/logo.svg"
        searchPlaceholder="Search Palamedes docs..."
        /* Light-only site by design ("Swiss Spec Grid" is a paper spec sheet);
         * re-enable once both token systems ship a dark set. */
        themeToggle={false}
      >
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
        <ArdoHeaderActions>
          <ArdoSocialLink
            href="https://github.com/sebastian-software/palamedes"
            icon="github"
            ariaLabel="Palamedes on GitHub"
          />
          <ButtonLink variant="small" href="/get-started" className="max-tight:hidden">
            Get started
          </ButtonLink>
        </ArdoHeaderActions>
      </ArdoHeader>
      <ArdoSidebar
        /* ArdoRoot supplies this sidebar to the mobile panel. Keep the CTA
         * there below the tight breakpoint, where the header action is hidden. */
        header={
          <div className="hidden px-4 pb-4 max-tight:block">
            <ButtonLink variant="primary" href="/get-started" className="w-full text-center">
              Get started
            </ButtonLink>
          </div>
        }
      >
        {renderSidebarSections()}
      </ArdoSidebar>
      <ArdoFooter>
        <div className="frame border-t-0">
          <SiteFooter />
        </div>
      </ArdoFooter>
    </ArdoRoot>
  )
}

export const ErrorBoundary = ArdoErrorBoundary
