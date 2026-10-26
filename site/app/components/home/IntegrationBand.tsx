import { FrameworkIdentity } from "~/components/FrameworkIdentity";
import { StreamlineIcon } from "~/components/icons/StreamlineIcon";
import { frameworkLandingHref } from "~/data/framework-landing";
import { repoHref } from "~/data/links";

type Mark = { name: string; asset: string; width: number; height: number };

type Application = {
  id: string;
  name: string;
  marks: readonly Mark[];
  body: string;
  guide: { label: string; href: string };
  example: { label: string; href: string };
};

const APPLICATIONS: readonly Application[] = [
  {
    id: "frontend-applications",
    name: "Frontend",
    marks: [],
    body: "Translate interfaces and server-rendered apps. Framework adapters prepare messages for rendering, hydration, and lazy screens.",
    guide: { label: "Frontend guides", href: "/frameworks" },
    example: { label: "Live app demos", href: "/frameworks#frontend-frameworks" },
  },
  {
    id: "backend-applications",
    name: "Backend",
    marks: [
      { name: "Hono", asset: "hono.svg", width: 24, height: 26 },
      { name: "Express", asset: "express-icon.svg", width: 24, height: 24 },
    ],
    body: "Localize emails, responses, and server-rendered content. Each request keeps its own language while sharing compiled catalogs.",
    guide: { label: "Backend guide", href: "/docs/backend-servers" },
    example: { label: "Server example", href: repoHref("examples/node-backend", "tree") },
  },
  {
    id: "cli-applications",
    name: "CLI",
    marks: [],
    body: "Give command-line programs a voice in another language. Node.js commands use the same messages and catalogs as your services.",
    guide: {
      label: "Node.js CLI guide",
      href: "/docs/backend-servers#one-setup-for-every-build",
    },
    example: {
      label: "CLI example",
      href: repoHref("examples/node-backend/src/cli.ts", "blob"),
    },
  },
  {
    id: "mdx-applications",
    name: "MDX",
    marks: [{ name: "MDX", asset: "mdx.svg", width: 58, height: 24 }],
    body: "Write documentation in one MDX source. Headings and prose become catalog messages; components, expressions, and code keep their structure.",
    guide: { label: "MDX + Vite guide", href: "/docs/mdx" },
    example: { label: "MDX live demo", href: "https://vite-mdx.examples.palamedes.dev" },
  },
  {
    id: "rust-applications",
    name: "Rust",
    marks: [{ name: "Rust", asset: "rust.svg", width: 36, height: 36 }],
    body: "Localize native CLIs and services with external language files. Compatible PO translation updates can ship without rebuilding your executable.",
    guide: { label: "Rust + Cargo guide", href: "/docs/rust-applications" },
    example: {
      label: "Rust example",
      href: repoHref("crates/palamedes-i18n/examples/cli", "tree"),
    },
  },
];

const FRONTEND_INTEGRATIONS = [
  { slug: "nextjs", name: "Next.js", href: frameworkLandingHref("nextjs") },
  { slug: "nuxt", name: "Nuxt", href: frameworkLandingHref("nuxt") },
  { slug: "sveltekit", name: "SvelteKit", href: frameworkLandingHref("sveltekit") },
  { slug: "tanstack", name: "TanStack Start", href: frameworkLandingHref("tanstack") },
  { slug: "react-router", name: "React Router", href: frameworkLandingHref("react-router") },
  { slug: "waku", name: "Waku", href: frameworkLandingHref("waku") },
  { slug: "remix", name: "Remix", href: frameworkLandingHref("remix") },
  { slug: "react", name: "React", href: "/get-started" },
  { slug: "solid", name: "Solid", href: frameworkLandingHref("solid") },
  { slug: "vue", name: "Vue", href: frameworkLandingHref("vue") },
  { slug: "svelte", name: "Svelte", href: frameworkLandingHref("svelte") },
] as const;

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
        <h2 className="display-serif text-[clamp(1.6rem,1.1rem+1.4vw,2.3rem)] leading-tight">
          A translation workflow for what you build.
        </h2>
        <p className="mt-4 max-w-[48rem] text-[17px] leading-relaxed text-ink/80">
          Start with your application. Each path has its own setup and a working example.
        </p>
        <ul
          aria-label="Application paths"
          className="mt-8 grid grid-cols-1 gap-px border border-hair bg-hair sm:grid-cols-2 xl:grid-cols-5"
        >
          {APPLICATIONS.map((application) => (
            <li
              key={application.id}
              id={application.id}
              className="flex min-w-0 flex-col bg-paper px-6 py-7"
            >
              <h3 className="text-[21px] font-semibold">{application.name}</h3>
              <div className="mt-5 flex min-h-16 items-start gap-5">
                {application.id === "frontend-applications" ? (
                  <span className="flex flex-col items-center gap-2">
                    <StreamlineIcon name="app-widgets-plugin-extension" className="size-8" />
                    <span className="text-[12px] text-ink/75">Web apps</span>
                  </span>
                ) : null}
                {application.marks.map((mark) => (
                  <span key={mark.name} className="flex flex-col items-center gap-2">
                    <span className="flex h-8 items-center">
                      <img
                        src={`/framework-logos/${mark.asset}`}
                        width={mark.width}
                        height={mark.height}
                        alt=""
                        aria-hidden="true"
                        className="shrink-0 object-contain"
                      />
                    </span>
                    <span className="text-[12px] text-ink/75">{mark.name}</span>
                  </span>
                ))}
                {application.name === "CLI" ? (
                  <span className="flex flex-col items-center gap-2">
                    <code aria-hidden="true" className="h-8 text-[26px] leading-8">
                      &gt;_
                    </code>
                    <span className="text-[12px] text-ink/75">Node.js</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-4 mb-6 text-[15.5px] leading-relaxed text-ink/80">
                {application.body}
              </p>
              <div className="mt-auto flex flex-col items-start gap-3">
                <a href={application.guide.href} className="pmds-arrow-link gap-2 text-[14px]">
                  <span>{application.guide.label}</span>
                  <span aria-hidden="true">→</span>
                </a>
                <a href={application.example.href} className="pmds-arrow-link gap-2 text-[14px]">
                  <span>{application.example.label}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
        <section
          aria-labelledby="framework-support-title"
          className="mt-8 border border-hair px-6 py-6 sm:px-8"
        >
          <h3 id="framework-support-title" className="display-serif text-[25px] leading-tight">
            Framework integrations
          </h3>
          <p className="mt-3 text-[16px] leading-relaxed text-ink/80">
            First-party guides for your app framework and UI library.
          </p>
          <ul aria-label="Frontend integrations" className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {FRONTEND_INTEGRATIONS.map((integration) => (
              <li key={integration.name}>
                <a
                  href={integration.href}
                  className="flex min-h-14 items-center px-2 hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <FrameworkIdentity slug={integration.slug} name={integration.name} />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hair pt-4">
            <p className="text-[14px] font-semibold text-ink/75">Build tools</p>
            <a
              href={frameworkLandingHref("vite")}
              className="flex min-h-14 items-center px-2 hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <FrameworkIdentity slug="vite" name="Vite" />
            </a>
            <a
              href={frameworkLandingHref("nextjs")}
              className="flex min-h-14 items-center px-2 hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <FrameworkIdentity slug="turbopack" name="Turbopack" />
            </a>
          </div>
        </section>
        <p className="mt-6 max-w-[56rem] text-[16px] leading-relaxed text-ink/80">
          One local toolchain connects these paths: extract messages, review PO catalogs, check
          translations, and compile them for your target.{" "}
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
