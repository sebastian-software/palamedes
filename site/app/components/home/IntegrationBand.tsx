import { Fragment } from "react";

import { frameworkLandingHref } from "~/data/framework-landing";

type Integration = {
  name: string;
  href: string;
  /** Shown as a mark when set; otherwise the name is set as text. */
  logo?: string;
  logoClass?: string;
  suffix?: string;
  note?: string;
};

type IntegrationGroup = { label: string; integrations: readonly Integration[] };

// Grouped by what each integration plugs into. Preview paths link to their
// scope; the stability guide owns the full compatibility contract.
const GROUPS: readonly IntegrationGroup[] = [
  {
    label: "UI frameworks",
    integrations: [
      {
        name: "React",
        href: "/get-started",
        logo: "/framework-logos/react.svg",
        logoClass: "h-6 w-auto",
        suffix: "React",
      },
      {
        name: "Solid",
        href: frameworkLandingHref("solid"),
        logo: "/framework-logos/solid.svg",
        logoClass: "h-6 w-6",
        suffix: "Solid",
      },
      {
        name: "Vue",
        href: frameworkLandingHref("vue"),
        suffix: "Vue",
        note: "preview",
      },
    ],
  },
  {
    label: "Frameworks",
    integrations: [
      {
        name: "Next.js",
        href: frameworkLandingHref("nextjs"),
        logo: "/framework-logos/nextjs.svg",
        logoClass: "h-4 w-auto max-w-[5.25rem]",
      },
      {
        name: "TanStack Start",
        href: frameworkLandingHref("tanstack"),
        logo: "/framework-logos/tanstack.svg",
        logoClass: "h-7 w-auto max-w-[5.25rem]",
      },
      {
        name: "React Router",
        href: frameworkLandingHref("react-router"),
        logo: "/framework-logos/react-router.svg",
        logoClass: "h-5 w-auto max-w-[6.5rem]",
      },
      {
        name: "Waku",
        href: frameworkLandingHref("waku"),
        logo: "/framework-logos/waku.svg",
        logoClass: "h-5 w-auto max-w-[5rem] brightness-0",
      },
      {
        name: "Remix",
        href: frameworkLandingHref("remix"),
        logo: "/framework-logos/remix.svg",
        logoClass: "h-4 w-auto max-w-[5.5rem]",
      },
    ],
  },
  {
    label: "Build tools",
    integrations: [
      {
        name: "Vite",
        href: frameworkLandingHref("vite"),
        logo: "/framework-logos/vite.svg",
        logoClass: "h-4 w-auto max-w-[5rem]",
      },
      // Set as text: Turbopack's mark belongs to Vercel, whose permission for
      // product marketing is still outstanding (framework-brand-usage.md).
      { name: "Turbopack", href: frameworkLandingHref("nextjs"), suffix: "Turbopack" },
    ],
  },
  {
    label: "Backends",
    integrations: [
      {
        name: "Hono",
        href: "/docs/backend-servers",
        logo: "/framework-logos/hono.svg",
        logoClass: "h-6 w-5",
        suffix: "Hono",
      },
      {
        name: "Express",
        href: "/docs/backend-servers",
        logo: "/framework-logos/express.svg",
        logoClass: "h-5 w-auto max-w-[6rem]",
      },
    ],
  },
  {
    label: "Rust",
    integrations: [
      {
        name: "Rust",
        href: "/docs/rust-applications",
        logo: "/framework-logos/rust.svg",
        logoClass: "h-7 w-7",
        suffix: "Rust",
        note: "new",
      },
    ],
  },
];

function IntegrationList({ group }: { group: IntegrationGroup }) {
  return (
    <div className="flex flex-col items-center">
      <p className="text-[13px] font-semibold text-ink/65">{group.label}</p>
      <ul
        aria-label={group.label}
        className="mt-1 flex flex-wrap items-center justify-center gap-x-1"
      >
        {group.integrations.map((integration) => (
          <li key={integration.name}>
            <a
              href={integration.href}
              aria-label={
                integration.note ? `${integration.name} (${integration.note})` : integration.name
              }
              className="group flex min-h-14 items-center gap-2.5 px-4 py-2 transition-colors hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              {integration.logo ? (
                <img
                  src={integration.logo}
                  alt=""
                  aria-hidden
                  className={`${integration.logoClass ?? ""} shrink-0 object-contain`}
                />
              ) : null}
              {integration.suffix ? (
                <span className="text-[15px] font-semibold tracking-[-0.01em] group-hover:text-accent">
                  {integration.suffix}
                </span>
              ) : null}
              {integration.note ? (
                <span className="border border-accent/60 px-1.5 py-px text-[11px] font-semibold text-accent">
                  {integration.note}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ASSURANCES = [
  "Open source — MIT OR Apache-2.0",
  "No account, no hosted service",
  "Translations live in your Git repository",
];

// Assets are downloaded unmodified from the project-controlled sources recorded
// in framework-brand-usage.md and THIRD_PARTY_NOTICES.md. The label beside an
// icon covers projects that publish an emblem but no separate wordmark asset.
// Marks identify first-party integrations, not customers or adoption.
export function IntegrationBand() {
  return (
    <section
      aria-label="First-party integrations"
      className="border-t border-hair px-[var(--pmds-gutter)] pt-12 pb-14"
    >
      <p className="text-center text-[15px] text-ink/80">
        First-party integrations, each verified with a working app
      </p>
      <div className="mx-auto mt-6 flex max-w-[72rem] flex-wrap items-start justify-center gap-x-8 gap-y-6">
        {GROUPS.map((group) => (
          <Fragment key={group.label}>
            {/* Build tools, backends and Rust start the second row. */}
            {group.label === "Build tools" ? <span aria-hidden className="basis-full" /> : null}
            <IntegrationList group={group} />
          </Fragment>
        ))}
      </div>
      <ul
        aria-label="Project boundaries"
        className="mx-auto mt-10 flex max-w-[64rem] flex-wrap justify-center gap-x-10 gap-y-3 border-t border-hair pt-8"
      >
        {ASSURANCES.map((assurance) => (
          <li key={assurance} className="flex items-center gap-2.5 text-[14px] text-ink/85">
            <span aria-hidden className="size-1.5 rotate-45 bg-accent" />
            {assurance}
          </li>
        ))}
      </ul>
    </section>
  );
}
