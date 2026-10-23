import { Fragment } from "react";

import { FrameworkIdentity } from "~/components/FrameworkIdentity";
import { frameworkLandingHref } from "~/data/framework-landing";

type Integration = {
  slug: string;
  name: string;
  href: string;
};

type IntegrationGroup = { label: string; integrations: readonly Integration[] };

// Grouped by what each integration plugs into. Detail pages own setup and scope.
const GROUPS: readonly IntegrationGroup[] = [
  {
    label: "UI frameworks",
    integrations: [
      {
        slug: "react",
        name: "React",
        href: "/get-started",
      },
      {
        slug: "solid",
        name: "Solid",
        href: frameworkLandingHref("solid"),
      },
      {
        slug: "remix",
        name: "Remix",
        href: frameworkLandingHref("remix"),
      },
      {
        slug: "vue",
        name: "Vue",
        href: frameworkLandingHref("vue"),
      },
      { slug: "svelte", name: "Svelte", href: frameworkLandingHref("svelte") },
    ],
  },
  {
    label: "App frameworks",
    integrations: [
      { slug: "sveltekit", name: "SvelteKit", href: frameworkLandingHref("sveltekit") },
      {
        slug: "nuxt",
        name: "Nuxt",
        href: frameworkLandingHref("nuxt"),
      },
      {
        slug: "nextjs",
        name: "Next.js",
        href: frameworkLandingHref("nextjs"),
      },
      {
        slug: "tanstack",
        name: "TanStack Start",
        href: frameworkLandingHref("tanstack"),
      },
      {
        slug: "solid",
        name: "Solid",
        href: frameworkLandingHref("solid"),
      },
      {
        slug: "react-router",
        name: "React Router",
        href: frameworkLandingHref("react-router"),
      },
      {
        slug: "waku",
        name: "Waku",
        href: frameworkLandingHref("waku"),
      },
      {
        slug: "remix",
        name: "Remix",
        href: frameworkLandingHref("remix"),
      },
    ],
  },
  {
    label: "Build tools",
    integrations: [
      {
        slug: "vite",
        name: "Vite",
        href: frameworkLandingHref("vite"),
      },
      { slug: "turbopack", name: "Turbopack", href: frameworkLandingHref("nextjs") },
    ],
  },
  {
    label: "Backends",
    integrations: [
      {
        slug: "hono",
        name: "Hono",
        href: "/docs/backend-servers",
      },
      {
        slug: "express",
        name: "Express",
        href: "/docs/backend-servers",
      },
    ],
  },
  {
    label: "Rust",
    integrations: [
      {
        slug: "rust",
        name: "Rust",
        href: "/docs/rust-applications",
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
              className="group flex min-h-14 items-center gap-2.5 px-4 py-2 transition-colors hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <FrameworkIdentity slug={integration.slug} name={integration.name} />
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
// in framework-brand-usage.md and THIRD_PARTY_NOTICES.md. Shared identities keep
// names and marks consistent with the framework matrix and setup overview.
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
