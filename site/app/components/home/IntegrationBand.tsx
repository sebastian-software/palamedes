import { frameworkLandingHref } from "~/data/framework-landing"

type Integration = {
  name: string
  href: string
  logo: string
  logoClass: string
  suffix?: string
  note?: string
}

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
    name: "SolidStart",
    href: frameworkLandingHref("solidstart"),
    logo: "/framework-logos/solidstart.svg",
    logoClass: "h-6 w-6",
    suffix: "SolidStart",
  },
  {
    name: "Waku",
    href: frameworkLandingHref("waku"),
    logo: "/framework-logos/waku.svg",
    logoClass: "h-5 w-auto max-w-[5rem] brightness-0",
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
]

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
]

function IntegrationList({
  integrations,
  label,
}: {
  integrations: readonly Integration[]
  label: string
}) {
  return (
    <div className="grid grid-cols-[minmax(10rem,0.7fr)_3fr] max-tight:grid-cols-1">
      <p className="micro border-r border-hair px-5 py-5 text-[10px] tracking-label text-gray-spec max-tight:border-r-0 max-tight:border-b">
        {label}
      </p>
      <ul
        aria-label={label}
        className={`grid ${integrations.length > 2 ? "grid-cols-4 max-grid:grid-cols-2" : "grid-cols-2"} max-tight:grid-cols-1`}
      >
        {integrations.map((integration) => (
          <li
            key={integration.name}
            className="border-r border-b border-hair last:border-r-0 even:max-grid:border-r-0 max-tight:border-r-0"
          >
            <a
              href={integration.href}
              aria-label={integration.name}
              className="group flex min-h-20 items-center justify-between gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <img
                  src={integration.logo}
                  alt={integration.suffix ? "" : integration.name}
                  aria-hidden={integration.suffix ? true : undefined}
                  className={`${integration.logoClass} shrink-0 object-contain`}
                />
                {integration.suffix ? (
                  <span className="text-[14px] font-semibold tracking-[-0.01em] group-hover:text-accent">
                    {integration.suffix}
                  </span>
                ) : null}
              </span>
              {integration.note ? (
                <span className="micro text-[10px] tracking-label text-gray-spec">
                  {integration.note}
                </span>
              ) : (
                <span aria-hidden className="text-accent">
                  →
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Assets are downloaded unmodified from the project-controlled sources recorded
// in framework-brand-usage.md and THIRD_PARTY_NOTICES.md. The label beside an
// icon covers projects that publish an emblem but no separate wordmark asset.
export function IntegrationBand() {
  return (
    <section aria-label="First-party integrations" className="border-b border-hair">
      <div className="grid grid-cols-[minmax(13rem,1fr)_3fr] max-grid:grid-cols-1">
        <div className="border-r border-hair px-7 py-6 max-grid:border-r-0 max-grid:border-b">
          <p className="eyebrow">First-party integrations</p>
          <p className="mt-3 max-w-[17rem] text-[13px] leading-relaxed text-ink/80">
            Frontend and full-stack adapters are verified as applications. Backend integrations use
            the same request-local runtime in Hono and Express.
          </p>
          <a
            href="https://github.com/sebastian-software/palamedes/blob/main/site/framework-brand-usage.md"
            className="micro mt-4 inline-block text-[10px] tracking-label text-accent underline underline-offset-4"
          >
            Brand-asset status →
          </a>
        </div>
        <div>
          <IntegrationList
            integrations={FRONTEND_INTEGRATIONS}
            label="Frontend and full-stack adapters"
          />
          <IntegrationList integrations={BACKEND_INTEGRATIONS} label="Backend integrations" />
        </div>
      </div>
    </section>
  )
}
