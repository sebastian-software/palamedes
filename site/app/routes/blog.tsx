import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { pageMeta } from "~/lib/meta";
import { CtaBand } from "~/components/home/CtaBand";
import { REPO } from "~/data/links";
import posts from "~/data/generated/blog-posts.json";

export const handle = { layout: "bare" };

const formatDate = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function meta() {
  return pageMeta({
    title: "Palamedes blog — notes from building i18n tooling in the open",
    description:
      "Design notes, honest benchmarks, and lessons from the third time around — written by the maintainer, not a content team.",
    path: "/blog",
  });
}

export default function Blog() {
  return (
    <Page>
      <PageHero
        kicker="Blog"
        title={<>Building i18n tooling in the&nbsp;open.</>}
        lede="Design notes, honest benchmarks, and lessons from the third time around — written by the maintainer, not a content team."
        actions={
          <>
            <ButtonLink href={posts[0]?.href ?? "/blog"}>Read the latest note</ButtonLink>
            <ButtonLink variant="outline" href="/proof">
              Inspect the evidence
            </ButtonLink>
          </>
        }
      />

      <Section num="01 — Posts" title="Notes from the maintainer.">
        <div className="border border-hair">
          {posts.map((post, index) => (
            <a
              key={post.title}
              href={post.href}
              className={`group grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-6 px-6 py-6 transition-colors hover:bg-hover-fill max-tight:grid-cols-[44px_minmax(0,1fr)] ${
                index > 0 ? "border-t border-hair" : ""
              }`}
            >
              <span className="mono-nums text-[12px] text-gray-spec">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <h3 className="text-[20px] leading-snug font-bold tracking-tight group-hover:text-accent">
                  {post.title}
                </h3>
                <p className="mt-2 max-w-[48em] text-[16px] leading-relaxed text-ink/80">
                  {post.excerpt}
                </p>
              </span>
              <span className="mono-nums text-right text-[11px] whitespace-nowrap text-gray-spec max-tight:col-start-2 max-tight:mt-2 max-tight:text-left">
                <time dateTime={post.date}>
                  {formatDate.format(new Date(`${post.date}T00:00:00Z`))}
                </time>
                <span aria-hidden> · </span>~{post.readMinutes} min
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
  );
}
