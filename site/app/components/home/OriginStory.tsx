import { Reveal } from "@palamedes/site-ui";
import { Link } from "react-router";

import { Band } from "~/components/marketing/Band";

/*
 * Origin and ownership. The quotation is the maintainer's own closing line
 * from "The third time I built JavaScript i18n tooling" on this site's blog.
 */
const OWNERSHIP = [
  {
    title: "Plain files in your repository",
    body: "Catalogs are gettext .po files: reviewable in pull requests, readable by translation tools, yours to take anywhere.",
  },
  {
    title: "Open source, both ways",
    body: "MIT OR Apache-2.0. Architecture, release rules, and security policy are public.",
  },
  {
    title: "Nothing to sign up for",
    body: "No account and no hosted service. The complete workflow runs on your machine and in your CI.",
  },
  {
    title: "A maintainer you can name",
    body: "Built and maintained by Sebastian Software GmbH, in the open.",
  },
] as const;

export function OriginStory() {
  return (
    <Band tone="parchment" labelledBy="origin-title">
      <div className="grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-[minmax(14rem,0.75fr)_minmax(0,2fr)]">
        <Reveal>
          <figure className="mx-auto max-w-[18rem] text-center lg:sticky lg:top-24">
            <img
              src="/logo.svg"
              alt="The Palamedes emblem: a laureled Greek head in a bronze ring"
              width={240}
              height={240}
              className="mx-auto w-full max-w-[15rem]"
            />
            <figcaption className="mt-6 text-[14px] leading-relaxed text-ink/75">
              <span className="display-serif block text-[17px] tracking-[0.12em] text-ink">
                Palamedes
              </span>
              Greek legend credits him with inventing letters of the alphabet — a fitting patron for
              software that teaches applications new languages.
            </figcaption>
          </figure>
        </Reveal>

        <div>
          <Reveal>
            <p className="pmds-kicker">Why it exists</p>
            <h2 id="origin-title" className="pmds-title max-w-[16em]">
              Built by someone who has done this three times.
            </h2>
            <div className="mt-7 max-w-[42rem] space-y-5 text-[17px] leading-[1.7] text-ink/85">
              <p>
                Palamedes is the third generation of i18n tooling from Sebastian Werner — after
                qooxdoo’s gettext-style tooling and an enterprise migration of thousands of
                hardcoded strings to Lingui. Each round taught the same lesson: a shortcut that
                feels good on the first screen becomes a migration two years later.
              </p>
              <p>
                So Palamedes keeps what proved durable — real sentences in the code, readable
                catalogs, one runtime model — and writes down every tradeoff before you depend on
                it.
              </p>
            </div>
            <blockquote className="mt-9 max-w-[40rem] border-t border-accent/40 pt-6">
              <p className="display-serif text-[clamp(1.35rem,2.2vw,1.85rem)] leading-[1.3] text-ink">
                “If the model feels boring in the right way, Palamedes is doing its job.”
              </p>
              <footer className="mt-3 text-[14px] text-ink/70">
                —{" "}
                <Link
                  to="/blog/the-third-time-i-built-javascript-i18n-tooling"
                  viewTransition
                  className="underline decoration-hair underline-offset-4 hover:text-accent hover:decoration-accent"
                >
                  Sebastian Werner, maintainer
                </Link>
              </footer>
            </blockquote>
          </Reveal>

          <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-8 border-t border-hair pt-10 sm:grid-cols-2">
            {OWNERSHIP.map((item) => (
              <li key={item.title}>
                <h3 className="flex items-center gap-2.5 text-[17px] font-bold">
                  <span aria-hidden className="size-1.5 rotate-45 bg-accent" />
                  {item.title}
                </h3>
                <p className="mt-2 text-[15.5px] leading-relaxed text-ink/80">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Band>
  );
}
