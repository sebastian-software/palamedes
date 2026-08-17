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
  ArdoSidebarGroup,
  ArdoSidebarLink,
  ArdoSidebarSection,
  ArdoSocialLink,
} from "ardo/ui"
import { ButtonLink, SiteFooter, SiteUiProvider } from "@palamedes/site-ui"
import config from "virtual:ardo/config"

import { OSS_SITE_CONFIG, RouterSiteLink } from "~/site-config"
import docsNavigation from "~/data/generated/docs-navigation.json"
import decisionLedger from "~/data/generated/decision-ledger.json"
import blogPosts from "~/data/generated/blog-posts.json"

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
        {docsNavigation.map((group) => (
          <ArdoSidebarGroup key={group.title} title={group.title} collapsed={group.collapsed}>
            {group.items.map((item) => (
              <ArdoSidebarLink key={item.route} to={item.route as never}>
                {item.title}
              </ArdoSidebarLink>
            ))}
          </ArdoSidebarGroup>
        ))}
      </ArdoSidebarSection>
      <ArdoSidebarSection id="api-reference" label="API" to="/api-reference">
        <ArdoGeneratedSidebar section="api-reference" />
      </ArdoSidebarSection>
      <ArdoSidebarSection id="decisions" label="Decisions" to="/decisions">
        <ArdoSidebarGroup title="Decision trail" collapsible={false}>
          {decisionLedger.map((decision) => (
            <ArdoSidebarLink key={decision.href} to={decision.href as never}>
              {decision.number} · {decision.title}
            </ArdoSidebarLink>
          ))}
        </ArdoSidebarGroup>
      </ArdoSidebarSection>
      <ArdoSidebarSection id="blog" label="Blog" to="/blog" match="/blog/">
        <ArdoSidebarGroup title="Notes from the maintainer" collapsible={false}>
          {blogPosts.map((post) => (
            <ArdoSidebarLink key={post.href} to={post.href as never}>
              {post.title}
            </ArdoSidebarLink>
          ))}
        </ArdoSidebarGroup>
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
    <SiteUiProvider linkComponent={RouterSiteLink}>
      <ArdoRoot
        config={config}
        editLink={{
          pattern: "https://github.com/sebastian-software/palamedes/edit/main/:path",
          text: "Edit this page on GitHub",
        }}
        lastUpdated={{ enabled: true, text: "Last updated" }}
      >
        <ArdoHeader
          logo={
            <img
              src={OSS_SITE_CONFIG.logoSrc}
              alt=""
              aria-hidden
              width={36}
              height={36}
              className="size-9"
            />
          }
          searchPlaceholder="Search Palamedes docs..."
          mobileMenuContent={
            <div className="border-t border-hair px-4 py-4">
              <ButtonLink
                href={OSS_SITE_CONFIG.primaryAction!.href}
                className="min-h-11 w-full text-center"
              >
                {OSS_SITE_CONFIG.primaryAction!.label}
              </ButtonLink>
            </div>
          }
          /* Light-only site by design ("Swiss Spec Grid" is a paper spec sheet);
           * re-enable once both token systems ship a dark set. */
          themeToggle={false}
        >
          <ArdoNav>
            {OSS_SITE_CONFIG.navigation.map((link) => (
              <ArdoNavLink key={link.href} className="pmds-nav-link" to={link.href}>
                {link.label}
              </ArdoNavLink>
            ))}
          </ArdoNav>
          <ArdoHeaderActions>
            <ArdoSocialLink
              href="https://github.com/sebastian-software/palamedes"
              icon="github"
              ariaLabel="Palamedes on GitHub"
            />
            <ButtonLink
              variant="small"
              href={OSS_SITE_CONFIG.primaryAction!.href}
              className="max-tight:hidden"
            >
              {OSS_SITE_CONFIG.primaryAction!.label}
            </ButtonLink>
          </ArdoHeaderActions>
        </ArdoHeader>
        <ArdoSidebar>{renderSidebarSections()}</ArdoSidebar>
        <ArdoFooter>
          <SiteFooter config={OSS_SITE_CONFIG} />
        </ArdoFooter>
      </ArdoRoot>
    </SiteUiProvider>
  )
}

export const ErrorBoundary = ArdoErrorBoundary
