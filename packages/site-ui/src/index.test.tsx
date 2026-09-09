import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  ButtonLink,
  EditorialRail,
  SiteFooter,
  SiteHeader,
  SiteUiProvider,
  defineSiteConfig,
} from "./index";
import type { SiteToolSwitcher } from "./index";

const baseConfig = defineSiteConfig({
  name: "Palamedes",
  homeHref: "/",
  navigation: [{ label: "Docs", href: "/docs" }],
  primaryAction: { label: "Get started", href: "/get-started" },
  counterpart: {
    label: "Palamedes+",
    href: "https://plus.palamedes.dev",
    enabled: false,
  },
  footerColumns: [{ title: "Project", links: [{ label: "Source", href: "https://example.com" }] }],
  copyright: "MIT",
});

const toolSwitcher: SiteToolSwitcher = {
  label: "Tools",
  ariaLabel: "Ferramenta family tools",
  groups: [
    {
      label: "Pipeline",
      tools: [{ label: "ferroni", href: "https://example.com/ferroni", job: "regex engine" }],
    },
    {
      label: "Language",
      tools: [
        { label: "ferrocat", href: "https://example.com/ferrocat", job: "translation catalogs" },
        { label: "palamedes", href: "/", job: "i18n toolchain", current: true },
      ],
    },
  ],
};

const familyConfig = defineSiteConfig({
  ...baseConfig,
  toolSwitcher,
  familyLine: {
    label: "Ferramenta family",
    href: "https://ferramenta.dev",
    tools: [
      { label: "ferroni", href: "https://example.com/ferroni" },
      { label: "palamedes", href: "/", current: true },
    ],
  },
});

describe("site chrome", () => {
  it("keeps a disabled counterpart out of header and footer output", () => {
    const markup = renderToStaticMarkup(
      <>
        <SiteHeader config={baseConfig} />
        <SiteFooter config={baseConfig} />
      </>,
    );

    expect(markup).not.toContain("plus.palamedes.dev");
    expect(markup).toContain('href="/docs"');
  });

  it("renders an enabled counterpart in both shared navigation surfaces", () => {
    const config = {
      ...baseConfig,
      counterpart: { ...baseConfig.counterpart!, enabled: true },
    };
    const markup = renderToStaticMarkup(
      <>
        <SiteHeader config={config} />
        <SiteFooter config={config} />
      </>,
    );

    expect(markup.match(/https:\/\/plus\.palamedes\.dev/gu)).toHaveLength(2);
  });

  it("uses the consumer link adapter for framework routing", () => {
    function TestLink({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) {
      return (
        <span data-to={href} className={className}>
          {children}
        </span>
      );
    }

    const markup = renderToStaticMarkup(
      <SiteUiProvider linkComponent={TestLink}>
        <ButtonLink href="/get-started">Start</ButtonLink>
      </SiteUiProvider>,
    );

    expect(markup).toContain('data-to="/get-started"');
    expect(markup).not.toContain("<a");
  });

  it("renders precise build metadata in the shared footer", () => {
    const markup = renderToStaticMarkup(
      <SiteFooter
        config={baseConfig}
        build={{
          builtAt: "2026-08-27T21:05:32.000Z",
          commitHash: "e9f0951ea5a128b307bb87cb94fd9a302a77b43e",
        }}
      />,
    );

    expect(markup).toContain('<time dateTime="2026-08-27T21:05:32.000Z">');
    expect(markup).toContain(">2026-08-27 21:05 UTC</time>");
    expect(markup).toContain("e9f0951e");
    expect(markup).not.toContain("e9f0951ea");
  });

  it("keeps the family surfaces out of a site that does not configure them", () => {
    const markup = renderToStaticMarkup(
      <>
        <SiteHeader config={baseConfig} />
        <SiteFooter config={baseConfig} />
      </>,
    );

    expect(markup).not.toContain("pmds-switcher");
    expect(markup).not.toContain("pmds-family-line");
  });

  it("renders the configured family switcher and marks the current tool", () => {
    const markup = renderToStaticMarkup(<SiteHeader config={familyConfig} />);

    expect(markup).toContain("<summary");
    expect(markup).toContain(">Tools</summary>");
    expect(markup).toContain(">Pipeline</p>");
    expect(markup).toContain(">Language</p>");
    expect(markup).toContain('href="https://example.com/ferroni"');
    expect(markup).toContain(">regex engine</span>");
    expect(markup.match(/aria-current="page"/gu)).toHaveLength(1);
  });

  it("renders the footer family line with the family site and every sibling", () => {
    const markup = renderToStaticMarkup(<SiteFooter config={familyConfig} />);

    expect(markup).toContain('href="https://ferramenta.dev"');
    expect(markup).toContain(">Ferramenta family</a>");
    expect(markup).toContain(">ferroni</span>");
    /* The line names tools, never their job lines. */
    expect(markup).not.toContain("pmds-family-job");
  });

  it("uses one-pixel editorial rails with an explicit semantic emphasis tone", () => {
    const markup = renderToStaticMarkup(
      <>
        <EditorialRail>Structural aside</EditorialRail>
        <EditorialRail tone="emphasis">Qualified position</EditorialRail>
      </>,
    );

    expect(markup).toContain("pmds-editorial-rail--structural");
    expect(markup).toContain("pmds-editorial-rail--emphasis");
    expect(markup.match(/<aside/g)).toHaveLength(2);
  });
});
