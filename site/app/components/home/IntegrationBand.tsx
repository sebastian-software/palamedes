import { frameworkLandingHref } from "~/data/framework-landing";

type Integration = {
  name: string;
  href: string;
  logo: string;
  logoClass: string;
  suffix?: string;
  note?: string;
};

const FRONTEND_INTEGRATIONS: readonly Integration[] = [
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
    suffix: "Start",
  },
  {
    name: "Solid",
    href: frameworkLandingHref("solid"),
    logo: "/framework-logos/solid.svg",
    logoClass: "h-6 w-6",
    suffix: "Solid",
  },
  {
    name: "Waku",
    href: frameworkLandingHref("waku"),
    logo: "/framework-logos/waku.svg",
    logoClass: "h-5 w-auto max-w-[5rem] brightness-0",
    note: "preview",
  },
  {
    name: "React Router",
    href: frameworkLandingHref("react-router"),
    logo: "/framework-logos/react-router.svg",
    logoClass: "h-5 w-auto max-w-[6.5rem]",
  },
  {
    name: "Remix v3",
    href: frameworkLandingHref("remix"),
    logo: "/framework-logos/remix.svg",
    logoClass: "h-4 w-auto max-w-[5.5rem]",
    note: "preview",
  },
  {
    name: "Vite",
    href: frameworkLandingHref("vite"),
    logo: "/framework-logos/vite.svg",
    logoClass: "h-4 w-auto max-w-[5rem]",
  },
];

const BACKEND_INTEGRATIONS: readonly Integration[] = [
  {
    name: "Hono",
    href: "/docs/backend-servers",
    logo: "/framework-logos/hono.svg",
    logoClass: "h-6 w-5",
    suffix: "Hono",
    note: "backend",
  },
  {
    name: "Express",
    href: "/docs/backend-servers",
    logo: "/framework-logos/express.svg",
    logoClass: "h-5 w-auto max-w-[6rem]",
    note: "backend",
  },
];

function IntegrationList({
  integrations,
  label,
}: {
  integrations: readonly Integration[];
  label: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      {integrations.map((integration) => (
        <li key={integration.name}>
          <a
            href={integration.href}
            aria-label={
              integration.note ? `${integration.name} (${integration.note})` : integration.name
            }
            className="group flex min-h-14 items-center gap-2.5 px-4 py-2 transition-colors hover:bg-parchment focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <img
              src={integration.logo}
              alt=""
              aria-hidden
              className={`${integration.logoClass} shrink-0 object-contain`}
            />
            {integration.suffix ? (
              <span className="text-[15px] font-semibold tracking-[-0.01em] group-hover:text-accent">
                {integration.suffix}
              </span>
            ) : null}
            {integration.note ? (
              <span className="micro text-[11px] tracking-label text-gray-spec">
                {integration.note}
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
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
        Frontend and full-stack adapters, each verified as a working app — plus the same runtime for
        Hono and Express
      </p>
      <div className="mx-auto mt-6 max-w-[64rem] space-y-1">
        <IntegrationList
          integrations={FRONTEND_INTEGRATIONS}
          label="Frontend and full-stack adapters"
        />
        <IntegrationList integrations={BACKEND_INTEGRATIONS} label="Backend integrations" />
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
