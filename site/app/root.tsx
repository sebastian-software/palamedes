import {
  ArdoErrorBoundary,
  ArdoGeneratedSidebar,
  ArdoHeader,
  ArdoHeaderActions,
  ArdoNav,
  ArdoRoot,
  ArdoRootLayout,
  ArdoSidebar,
  ArdoSidebarGroup,
  ArdoSidebarLink,
  ArdoSidebarSection,
  ArdoSocialLink,
} from "ardo/ui";
import { ButtonLink, SiteFooter, SiteUiProvider, ToolSwitcher } from "@palamedes/site-ui";
import { ArdoLink as Link, useArdoPath } from "ardo/runtime";
import config from "virtual:ardo/config";

import { OSS_SITE_CONFIG, RouterSiteLink } from "~/site-config";
import docsNavigation from "~/data/generated/docs-navigation.json";
import decisionLedger from "~/data/generated/decision-ledger.json";
import blogPosts from "~/data/generated/blog-posts.json";
import editSources from "~/data/generated/edit-sources.json";
import { PRIMARY_NAVIGATION_GROUPS, isPrimaryNavigationLinkActive } from "~/data/navigation";
import { SiteAnalytics } from "~/components/SiteAnalytics";

import { PALAMEDES_THEME } from "./ardo-theme";

import "./app.css";

export function meta() {
  return [
    {
      tagName: "link" as const,
      rel: "preload",
      href: "/fonts/CinzelHellenic-Regular.woff2",
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous" as const,
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ArdoRootLayout colorScheme="light" icon="/favicon.svg">
      {children}
    </ArdoRootLayout>
  );
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
  );
}

function PrimaryNavigation() {
  const pathname = useArdoPath();

  return (
    <ArdoNav className="pmds-primary-nav">
      {PRIMARY_NAVIGATION_GROUPS.map((group) => (
        <div key={group.label} className="pmds-nav-group" role="group" aria-label={group.label}>
          <span className="pmds-nav-group-label" aria-hidden>
            {group.label}
          </span>
          {group.links.map((link) => {
            const active = isPrimaryNavigationLinkActive(link, pathname);
            return (
              <Link
                key={link.href}
                className={`pmds-nav-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                to={link.href}
                data-analytics-id={`primary-nav-${link.href}`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </ArdoNav>
  );
}

/*
 * Ardo owns the header and documentation layout. The shared footer follows
 * its frame so it remains a page-level landmark outside the main content.
 * The typed theme and public layout slots preserve the editorial design
 * without targeting Ardo implementation classes.
 */
const EDIT_SOURCES: Readonly<Record<string, string>> = editSources;

/* Pages generated from docs/, adr/, or blog sources link to that file; other
 * pages (marketing, the docs landing page, generated API output) get no edit link. */
function editLinkFor(pathname: string) {
  const route = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  const source = EDIT_SOURCES[route];
  return source
    ? {
        pattern: `https://github.com/sebastian-software/palamedes/edit/main/${source}`,
        text: "Edit this page on GitHub",
      }
    : undefined;
}

export default function App() {
  const build =
    import.meta.env.PROD && config.buildTime
      ? { builtAt: config.buildTime, commitHash: __PALAMEDES_BUILD_HASH__ }
      : undefined;
  const pathname = useArdoPath();

  return (
    <SiteUiProvider linkComponent={RouterSiteLink}>
      <SiteAnalytics />
      <ArdoRoot
        footer={false}
        theme={PALAMEDES_THEME}
        scrollMode="document"
        icon="/favicon.svg"
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
        tocLabel="Page outline"
        editLink={editLinkFor(pathname)}
        lastUpdated={{ enabled: true, text: "Last updated" }}
      >
        <ArdoHeader
          search="icon"
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
          <PrimaryNavigation />
          <ArdoHeaderActions>
            {/*
             * The family switcher sits with the header actions, in the site's
             * own editorial style (decision D6). It needs the room a flyout
             * takes, so below the tight breakpoint the footer family line is
             * the family surface — the same width at which ARDO already folds
             * the primary action away.
             */}
            {OSS_SITE_CONFIG.toolSwitcher ? (
              <ToolSwitcher switcher={OSS_SITE_CONFIG.toolSwitcher} className="max-tight:hidden" />
            ) : null}
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
      </ArdoRoot>
      <SiteFooter config={OSS_SITE_CONFIG} build={build} />
    </SiteUiProvider>
  );
}

export const ErrorBoundary = ArdoErrorBoundary;
