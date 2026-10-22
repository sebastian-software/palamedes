import { Link } from "react-router";

import { StreamlineIcon, type StreamlineIconName } from "~/components/icons/StreamlineIcon";

const QUESTIONS = [
  {
    icon: "deployment-workflow-collaboration",
    question: "Starting a new project?",
    answer:
      "Pick your framework and get a first message rendering in a second language — yourself or with your coding agent.",
    href: "/get-started",
    label: "Start the guided setup",
    resources: [
      { label: "Frontend and full-stack adapters", href: "/frameworks#frontend-frameworks" },
      { label: "Backend services", href: "/frameworks#backend-integrations" },
      { label: "Rust applications", href: "/docs/rust-applications" },
      { label: "Set up with your coding agent", href: "/docs/agent-skill" },
    ],
  },
  {
    icon: "app-widgets-plugin-extension",
    question: "Moving an existing app?",
    answer:
      "Bring your translations with you. For Lingui, the migration guide and agent skill preserve existing PO translations; for other stacks, start with an honest comparison.",
    href: "/docs/migrate-from-lingui",
    label: "Read the migration guide",
    resources: [
      { label: "Compare with your current tool", href: "/compare" },
      { label: "React Server Components", href: "/react-server-components-i18n" },
    ],
  },
  {
    icon: "globe-app-network",
    question: "Deciding how languages appear in URLs?",
    answer:
      "Cookie, path, subdomain, or country domain: understand what each one costs before you wire it into the host.",
    href: "/locale-routing",
    label: "Explore locale architecture",
    resources: [
      { label: "Locale-strategy reference", href: "/docs/locale-strategies" },
      { label: "Technical guides", href: "/guides" },
    ],
  },
  {
    icon: "code-analysis",
    question: "Evaluating it for your team?",
    answer:
      "Check the system boundary, performance, and message semantics against your constraints — then re-run the evidence.",
    href: "/architecture",
    label: "Inspect the architecture",
    resources: [
      { label: "Performance", href: "/i18n-performance" },
      { label: "ICU MessageFormat", href: "/icu-messageformat" },
      { label: "Proof", href: "/proof" },
      { label: "Reference docs", href: "/docs" },
    ],
  },
] as const satisfies ReadonlyArray<{
  icon: StreamlineIconName;
  question: string;
  answer: string;
  href: string;
  label: string;
  resources: readonly { label: string; href: string }[];
}>;

export function QuestionRoutes() {
  return (
    <ul
      aria-label="Decision paths"
      className="grid grid-cols-1 gap-px border border-hair bg-hair md:grid-cols-2"
    >
      {QUESTIONS.map((entry) => (
        <li key={entry.question} className="flex min-w-0 flex-col bg-paper px-7 py-8">
          <StreamlineIcon name={entry.icon} className="size-8" />
          <h3 className="mt-5 text-[22px] leading-snug font-bold tracking-[-0.015em]">
            {entry.question}
          </h3>
          <p className="mt-3 max-w-[32rem] text-[16px] leading-relaxed text-ink/80">
            {entry.answer}
          </p>
          <Link
            to={entry.href}
            viewTransition
            className="pmds-button pmds-button--outline mt-6 self-start"
          >
            {entry.label}
          </Link>
          <ul
            aria-label={`${entry.question} resources`}
            className="mt-5 flex flex-wrap gap-x-5 border-t border-hair pt-3"
          >
            {entry.resources.map((resource) => (
              <li key={resource.href}>
                <Link to={resource.href} viewTransition className="pmds-arrow-link text-[12.5px]">
                  {resource.label}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
