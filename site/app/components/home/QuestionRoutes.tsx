import { Link } from "react-router"

import { StreamlineIcon, type StreamlineIconName } from "~/components/icons/StreamlineIcon"

const QUESTIONS = [
  {
    icon: "app-widgets-plugin-extension",
    question: "Where does Palamedes need to run?",
    answer:
      "Choose a frontend or full-stack adapter, or take the same request-local model into a backend service.",
    href: "/frameworks",
    label: "Choose an integration",
    resources: [
      { label: "Frontend and full-stack adapters", href: "/frameworks#frontend-frameworks" },
      { label: "Backend services", href: "/frameworks#backend-integrations" },
      { label: "React Server Components", href: "/react-server-components-i18n" },
    ],
  },
  {
    icon: "globe-app-network",
    question: "How should locale selection live in the application?",
    answer:
      "Compare cookie, route-prefix, subdomain, and top-level-domain shapes before wiring the host.",
    href: "/locale-routing",
    label: "Explore locale architecture",
    resources: [
      { label: "Locale-strategy reference", href: "/docs/locale-strategies" },
      { label: "Verified application matrix", href: "/frameworks#frontend-frameworks" },
    ],
  },
  {
    icon: "code-analysis",
    question: "Does the architecture fit your constraints?",
    answer:
      "Inspect the system boundary first, then test its performance, message semantics, and evidence.",
    href: "/architecture",
    label: "Inspect the architecture",
    resources: [
      { label: "Performance", href: "/i18n-performance" },
      { label: "ICU MessageFormat", href: "/icu-messageformat" },
      { label: "Proof", href: "/proof" },
      { label: "Comparisons", href: "/compare" },
    ],
  },
  {
    icon: "deployment-workflow-collaboration",
    question: "Are you starting fresh or moving an existing stack?",
    answer:
      "Follow one guided first translation, or enter through the migration and implementation material you need.",
    href: "/get-started",
    label: "Start the guided setup",
    resources: [
      { label: "Technical guides", href: "/guides" },
      { label: "Migration guide", href: "/docs/migrate-from-lingui" },
      { label: "Reference docs", href: "/docs" },
    ],
  },
] as const satisfies ReadonlyArray<{
  icon: StreamlineIconName
  question: string
  answer: string
  href: string
  label: string
  resources: readonly { label: string; href: string }[]
}>

export function QuestionRoutes() {
  return (
    <ul aria-label="Decision paths" className="border-y border-hair">
      {QUESTIONS.map((entry) => (
        <li
          key={entry.question}
          className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-5 border-b border-hair px-5 py-5 last:border-b-0 max-grid:grid-cols-[2.5rem_minmax(0,1fr)] max-tight:grid-cols-[2rem_minmax(0,1fr)] max-tight:gap-3"
        >
          <span className="pt-0.5">
            <StreamlineIcon name={entry.icon} />
          </span>
          <div className="min-w-0">
            <h3>
              <Link
                to={entry.href}
                viewTransition
                className="group grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-tight:grid-cols-1 max-tight:gap-1"
              >
                <span className="text-[15px] font-semibold leading-snug group-hover:text-accent">
                  {entry.question}
                </span>
                <span className="micro text-[10px] tracking-label text-accent">
                  {entry.label} →
                </span>
              </Link>
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink/75">{entry.answer}</p>
            <ul
              aria-label={`${entry.question} resources`}
              className="mt-2 flex flex-wrap gap-x-5 gap-y-1"
            >
              {entry.resources.map((resource) => (
                <li key={resource.href}>
                  <Link
                    to={resource.href}
                    viewTransition
                    className="inline-flex min-h-11 items-center text-[12.5px] text-accent underline decoration-hair underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {resource.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ul>
  )
}
