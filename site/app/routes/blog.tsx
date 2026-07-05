import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { REPO } from "~/data/links"
import { POSTS } from "~/data/posts"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes blog — notes from building i18n tooling in the open",
    description:
      "Design notes, honest benchmarks, and lessons from the third time around — written by the maintainer, not a content team.",
    path: "/blog",
  })
}

export default function Blog() {
  return (
    <Page>
      <section className="relative overflow-hidden px-8 pt-16 pb-14 max-tight:px-5">
        {/* Style break: oversized ghosted section glyph behind the hero. */}
        <span
          aria-hidden
          className="ghost-glyph absolute -top-14 right-6 text-[260px] leading-none select-none"
        >
          §
        </span>
        <p className="eyebrow">Blog</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Building i18n tooling in the&nbsp;open.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Design notes, honest benchmarks, and lessons from the third time around — written by the
          maintainer, not a content team.
        </p>
      </section>

      <Section num="01 — Posts">
        <div className="border border-hair">
          {POSTS.map((post, index) => (
            <a
              key={post.title}
              href={post.href}
              className={`group grid grid-cols-[64px_1fr_auto] items-baseline gap-6 px-6 py-6 transition-colors hover:bg-hover-fill max-tight:grid-cols-[44px_1fr] ${
                index > 0 ? "border-t border-hair" : ""
              }`}
            >
              <span className="mono-nums text-[12px] text-gray-spec">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <h3 className="text-[17px] font-bold tracking-tight group-hover:text-accent">
                  {post.title}
                </h3>
                <p className="mt-1.5 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">
                  {post.excerpt}
                </p>
              </span>
              <span className="mono-nums text-[11px] whitespace-nowrap text-gray-spec max-tight:hidden">
                ~{post.readMinutes} min
              </span>
            </a>
          ))}
        </div>
      </Section>

      <CtaBand
        headline="Prefer reading code to reading posts?"
        primary={{ label: "Browse the repo", href: REPO }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />
    </Page>
  )
}
