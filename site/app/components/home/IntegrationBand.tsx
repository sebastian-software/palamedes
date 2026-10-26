import { FrameworkIdentity } from "~/components/FrameworkIdentity";
import { frameworkLandingHref } from "~/data/framework-landing";
import { repoHref } from "~/data/links";

type Integration = { slug: string; name: string; href: string };
type IntegrationGroup = {
  id: string;
  label: string;
  integrations: readonly Integration[];
  example?: { label: string; href: string };
};

const GROUPS: readonly IntegrationGroup[] = [
  {
    id: "framework-integrations",
    label: "Frameworks",
    integrations: [
      { slug: "nextjs", name: "Next.js", href: frameworkLandingHref("nextjs") },
      { slug: "nuxt", name: "Nuxt", href: frameworkLandingHref("nuxt") },
      { slug: "sveltekit", name: "SvelteKit", href: frameworkLandingHref("sveltekit") },
      { slug: "tanstack", name: "TanStack Start", href: frameworkLandingHref("tanstack") },
      { slug: "react-router", name: "React Router", href: frameworkLandingHref("react-router") },
      { slug: "waku", name: "Waku", href: frameworkLandingHref("waku") },
      { slug: "remix", name: "Remix", href: frameworkLandingHref("remix") },
    ],
  },
  {
    id: "ui-library-integrations",
    label: "UI Libraries",
    integrations: [
      { slug: "react", name: "React", href: "/get-started" },
      { slug: "solid", name: "Solid", href: frameworkLandingHref("solid") },
      { slug: "vue", name: "Vue", href: frameworkLandingHref("vue") },
      { slug: "svelte", name: "Svelte", href: frameworkLandingHref("svelte") },
    ],
  },
  {
    id: "build-tool-integrations",
    label: "Build Tools",
    integrations: [
      { slug: "vite", name: "Vite", href: frameworkLandingHref("vite") },
      { slug: "turbopack", name: "Turbopack", href: frameworkLandingHref("nextjs") },
    ],
  },
  {
    id: "backend-applications",
    label: "Backends",
    integrations: [
      { slug: "hono", name: "Hono", href: "/docs/backend-servers#hono-example" },
      { slug: "express", name: "Express", href: "/docs/backend-servers#express-example" },
    ],
  },
  {
    id: "cli-applications",
    label: "CLI",
    integrations: [
      {
        slug: "nodejs",
        name: "Node.js CLI",
        href: "/docs/backend-servers#one-setup-for-every-build",
      },
    ],
    example: { label: "CLI example", href: repoHref("examples/node-backend/src/cli.ts", "blob") },
  },
  {
    id: "mdx-applications",
    label: "MDX",
    integrations: [{ slug: "mdx", name: "MDX", href: "/docs/mdx" }],
    example: { label: "MDX live demo", href: "https://vite-mdx.examples.palamedes.dev" },
  },
  {
    id: "rust-applications",
    label: "Rust",
    integrations: [{ slug: "rust", name: "Rust", href: "/docs/rust-applications" }],
    example: {
      label: "Rust example",
      href: repoHref("crates/palamedes-i18n/examples/cli", "tree"),
    },
  },
];

const ASSURANCES = [
  "Open source — MIT OR Apache-2.0",
  "No account, no hosted service",
  "Translations live in your Git repository",
];

// Marks identify integrations, not adoption or endorsement. Their original
// artwork and provenance are recorded in framework-brand-usage.md.
export function IntegrationBand() {
  return (
    <section
      id="applications"
      aria-label="First-party integrations"
      className="border-t border-hair px-[var(--pmds-gutter)] pt-12 pb-14"
    >
      <div className="mx-auto max-w-[var(--pmds-measure)]">
        <h2
          id="framework-support-title"
          className="display-serif scroll-mt-20 text-[clamp(1.6rem,1.1rem+1.4vw,2.3rem)] leading-tight"
        >
          Built into your stack.
        </h2>
        <p className="mt-4 max-w-[48rem] text-[17px] leading-relaxed text-ink/80">
          Choose your integration. Each guide explains the setup and supported scope.
        </p>
        <ul aria-label="Integration groups" className="mt-8 border-b border-hair">
          {GROUPS.map((group) => (
            <li
              key={group.id}
              id={group.id}
              className="grid min-w-0 gap-x-6 gap-y-2 border-t border-hair py-3 lg:grid-cols-[9rem_minmax(0,1fr)]"
            >
              <h3 className="text-[16px] font-semibold lg:flex lg:min-h-14 lg:items-center">
                {group.label}
              </h3>
              <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
                <ul
                  aria-label={group.label}
                  className="flex min-w-0 flex-wrap items-center gap-2 [--pmds-identity-gap:10px] [--pmds-identity-inset:0px] [--pmds-identity-justify:center] [--pmds-identity-mark-max-width:40px] [--pmds-identity-slot-width:32px] [--pmds-identity-wide-slot-width:40px]"
                >
                  {group.integrations.map((integration) => (
                    <li key={integration.name}>
                      <a
                        href={integration.href}
                        className="flex min-h-11 items-center rounded-lg border border-hair bg-white px-3 shadow-sm shadow-ink/10 hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <FrameworkIdentity slug={integration.slug} name={integration.name} />
                      </a>
                    </li>
                  ))}
                </ul>
                {group.example ? (
                  <a href={group.example.href} className="pmds-arrow-link gap-2">
                    <span>{group.example.label}</span>
                    <span aria-hidden="true">→</span>
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-[56rem] text-[16px] leading-relaxed text-ink/80">
          One local toolchain connects these integrations: extract messages, review PO catalogs,
          check translations, and compile them for your target.{" "}
          <a href="/docs/cli" className="pmds-arrow-link">
            Explore the pmds toolchain →
          </a>
        </p>
        <ul
          aria-label="Project boundaries"
          className="mt-8 flex flex-wrap gap-x-10 gap-y-3 border-t border-hair pt-6"
        >
          {ASSURANCES.map((assurance) => (
            <li key={assurance} className="flex items-center gap-2.5 text-[14px] text-ink/85">
              <span aria-hidden className="size-1.5 rotate-45 bg-accent" />
              {assurance}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
