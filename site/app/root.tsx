import {
  ArdoErrorBoundary,
  ArdoGeneratedSidebar,
  ArdoFooter,
  ArdoNavLink,
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

import { ArdoLink as Link, useArdoPath } from "ardo/runtime";

import { FAMILY_SITE } from "ferramenta-family/registry";
import { repoHref } from "~/data/links";
import docsNavigation from "~/data/generated/docs-navigation.json";
import decisionLedger from "~/data/generated/decision-ledger.json";
import blogPosts from "~/data/generated/blog-posts.json";
import editSources from "~/data/generated/edit-sources.json";
import { PRIMARY_NAVIGATION_LINKS } from "~/data/navigation";
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
  const pathname = useArdoPath();

  return (
    <>
      <SiteAnalytics />
      <ArdoRoot
        theme={PALAMEDES_THEME}
        scrollMode="document"
        icon="/favicon.svg"
        logo="/logo.svg"
        tocLabel="Page outline"
        editLink={editLinkFor(pathname)}
        lastUpdated={{ enabled: true, text: "Last updated" }}
      >
        <ArdoHeader search="icon" themeToggle={false}>
          <ArdoNav>
            {PRIMARY_NAVIGATION_LINKS.map((link) => (
              <ArdoNavLink key={link.href} to={link.href} activeMatch={link.activeMatch}>
                {link.label}
              </ArdoNavLink>
            ))}
          </ArdoNav>
          <ArdoHeaderActions>
            <ArdoNavLink href={FAMILY_SITE}>Ferramenta</ArdoNavLink>
            <ArdoSocialLink
              href="https://github.com/sebastian-software/palamedes"
              icon="github"
              ariaLabel="Palamedes on GitHub"
            />
          </ArdoHeaderActions>
        </ArdoHeader>
        <ArdoSidebar>{renderSidebarSections()}</ArdoSidebar>
        <ArdoFooter
          buildHash={import.meta.env.PROD ? __PALAMEDES_BUILD_HASH__ : undefined}
          message={
            <>
              <Link to="/get-started">Get started</Link>
              {" · "}
              <Link to="/proof">Benchmarks</Link>
              {" · "}
              <Link to="/compare">Comparison</Link>
              {" · "}
              <Link to="/decisions">Decisions</Link>
              {" · "}
              <Link to="/blog">Blog</Link>
              {" · "}
              <a href={FAMILY_SITE}>Ferramenta</a>
              {" · "}
              <a href="https://www.streamlinehq.com/">Icons by Streamline</a>
            </>
          }
          copyright={
            <>
              <a href={repoHref("README.md#license")}>MIT OR Apache-2.0</a>
              {" © 2025–2026 "}
              <a href="https://oss.sebastian-software.com/">Sebastian Software GmbH</a>
            </>
          }
        />
      </ArdoRoot>
    </>
  );
}

export const ErrorBoundary = ArdoErrorBoundary;
