const QUESTIONS = [
  {
    question: "Which framework are you building with?",
    answer:
      "See the supported hosts, adapters, example applications, and their verification state.",
    href: "/frameworks",
    label: "Choose a framework",
  },
  {
    question: "How should locale selection live in the URL?",
    answer: "Compare cookie, route-prefix, subdomain, and top-level-domain application shapes.",
    href: "/locale-routing",
    label: "Explore locale architecture",
  },
  {
    question: "Will catalog work stay fast in a large repository?",
    answer:
      "Inspect the measured extract-and-update workflow, corpus, commands, and exact results.",
    href: "/proof",
    label: "Review the evidence",
  },
  {
    question: "Are you moving from an existing i18n stack?",
    answer:
      "Start with the migration guide, then use a comparison page when the incumbent matters.",
    href: "/docs/migrate-from-lingui",
    label: "Read the migration guide",
  },
  {
    question: "How does Palamedes compare with another tool?",
    answer:
      "Read bounded, source-specific comparisons that keep measured and researched claims separate.",
    href: "/compare",
    label: "Compare architectures",
  },
] as const

export function QuestionRoutes() {
  return (
    <div className="border-y border-hair">
      {QUESTIONS.map((entry, index) => (
        <a
          key={entry.href}
          href={entry.href}
          className="group grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(12rem,0.72fr)_auto] gap-5 border-b border-hair px-5 py-5 last:border-b-0 hover:bg-track focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent max-grid:grid-cols-[2.5rem_1fr_auto] max-tight:grid-cols-[2rem_1fr]"
        >
          <span className="mono-nums text-[11px] text-gray-spec">0{index + 1}</span>
          <span>
            <span className="block text-[15px] font-semibold leading-snug">{entry.question}</span>
            <span className="mt-1.5 block text-[13px] leading-relaxed text-ink/75 max-grid:hidden">
              {entry.answer}
            </span>
          </span>
          <span className="micro self-center text-[10px] tracking-label text-accent max-tight:hidden">
            {entry.label}
          </span>
          <span aria-hidden className="self-center text-accent">
            →
          </span>
        </a>
      ))}
    </div>
  )
}
