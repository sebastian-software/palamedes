import type { ReactNode } from "ardo/react";

import { CodeBlock } from "~/components/marketing/CodeBlock";
import { BandHeader } from "~/components/marketing/Band";
import { PlainWords } from "~/components/marketing/PlainWords";
import {
  JOURNEY_COMPILED,
  JOURNEY_PO,
  JOURNEY_PO_TRANSLATED,
  JOURNEY_SOURCE,
  JOURNEY_TRANSFORMED,
} from "~/data/journey";

import { RenderedCard } from "./RenderedCard";
import { SplitDiagram } from "./SplitDiagram";

/*
 * The guided tour: one sentence from the editor to the visitor. Every stop
 * opens with the benefit, explains the mechanism in plain words for readers
 * new to i18n tooling, and shows the real artifact that stop produces.
 */

interface Stop {
  step: string;
  title: string;
  body: string;
  plain: { question: string; answer: string };
  artifact: ReactNode;
}

const STOPS: Stop[] = [
  {
    step: "Write",
    title: "You write a sentence, not a key.",
    body: "Wrap visible text in <Trans> and counts in <Plural>. The component reads like the interface you are building, so anyone reviewing the pull request can check the copy right there.",
    plain: {
      question: "What is a macro?",
      answer:
        "Code that is rewritten while your app is built. <Trans> looks like a normal component, but it never ships as written: the build swaps it for something smaller and faster — you will see what at stop four. JSX works the same way; the browser never sees <div>, only the function calls it compiles to.",
    },
    artifact: (
      <CodeBlock
        label="src/TripCard.tsx — what you write"
        code={JOURNEY_SOURCE}
        marks={["Your trip starts tomorrow.", "# seat left", "# seats left"]}
      />
    ),
  },
  {
    step: "Extract",
    title: "One command finds every sentence.",
    body: "pmds extract reads all your source files in parallel and collects every message into one catalog per language. New sentences appear, deleted ones are marked obsolete, nobody copies text by hand.",
    plain: {
      question: "What is extraction?",
      answer:
        "The way text leaves your code for translation. Instead of someone copying strings into a spreadsheet, a tool scans the code and writes down everything that needs translating — together with the file and component each sentence came from.",
    },
    artifact: (
      <CodeBlock
        label="$ pmds extract → src/locales/de.po"
        code={JOURNEY_PO}
        marks={['msgstr ""']}
        tone="file"
        caption="Both messages are waiting for a German translation. The English catalog fills itself: in the source language, the sentence is the translation."
      />
    ),
  },
  {
    step: "Translate",
    title: "Translators get a real file, not your codebase.",
    body: "Each language is a plain .po file in your repository. Translators fill in msgstr — by hand, in a translation tool, or through your own scripts — and the change arrives as a diff you can review.",
    plain: {
      question: "What is a .po file?",
      answer:
        "The gettext catalog format, in use since the 1990s. Each entry holds the original sentence, its translation, and where it came from. Because it is plain text and a long-standing standard, translation tools can open it, Git can diff it, and your translations never depend on one vendor.",
    },
    artifact: (
      <CodeBlock
        label="src/locales/de.po — translated"
        code={JOURNEY_PO_TRANSLATED}
        marks={[
          '"Deine Reise beginnt morgen."',
          '"{seats, plural, one {# Platz frei} other {# Plätze frei}}"',
        ]}
        tone="file"
      />
    ),
  },
  {
    step: "Build",
    title: "Your build turns sentences into tiny functions.",
    body: "During the build, each <Trans> becomes a short ID and every translation becomes ready-to-run JavaScript. Plural rules, numbers, and dates are prepared once, on your machine — and a broken message fails the build instead of a visitor’s page.",
    plain: {
      question: "What does “compiled” mean here?",
      answer:
        "A message like {seats, plural, one {…} other {…}} is a small language of its own (ICU MessageFormat). Something has to understand it before “3 Plätze frei” can appear. Palamedes does that work at build time and ships the finished result, so the browser only runs plain code — no message parser included.",
    },
    artifact: (
      <div className="space-y-4">
        <CodeBlock
          label="Your component after the build"
          code={JOURNEY_TRANSFORMED}
          marks={['id="rPAYxZI1G3I"', 'getI18n()._("vqH_FEPt0Hs", { seats })']}
        />
        <CodeBlock
          label="The German catalog after the build"
          code={JOURNEY_COMPILED}
          marks={['"Deine Reise beginnt morgen."', '" Platz frei"', '" Plätze frei"']}
          caption="Real output of the Palamedes compiler for this example — formatted, with readable names for the generated functions."
        />
      </div>
    ),
  },
  {
    step: "Deliver",
    title: "Each screen loads only its own words.",
    body: "A real app holds thousands of messages in many languages, but a visitor needs one language and only the screens they open. Palamedes ships each screen’s translations together with its code. On the server, all requests share one copy of each language’s catalog.",
    plain: {
      question: "Why load messages later?",
      answer:
        "Think of a restaurant: you get the dish you ordered, not the whole cookbook. Sending every translation up front makes the first page heavier for everyone; sending them per screen keeps it light, however large the app grows.",
    },
    artifact: <SplitDiagram />,
  },
  {
    step: "Render",
    title: "Your visitor simply reads their language.",
    body: "The right words are in the server-rendered HTML, stay correct when the page becomes interactive, and follow into server actions. Switch the language and copy and plural rules change together — the component never did.",
    plain: {
      question: "What is a locale?",
      answer:
        "A language, sometimes with a region: de, fr-CA, ja. Your app decides which one a visitor gets — from the URL, the domain, or a remembered choice — and Palamedes makes sure every part of the page uses it.",
    },
    artifact: <RenderedCard />,
  },
];

export function Journey() {
  return (
    <section
      id="journey"
      aria-labelledby="journey-title"
      className="pmds-band pmds-band--parchment"
    >
      <BandHeader
        id="journey-title"
        kicker="How it works"
        title="Follow one sentence from your editor to your visitor."
        lede="Six stops, each explained in plain words. You don’t need an i18n background — just the one component below."
      />
      <nav aria-label="Stops on the tour" className="mt-10">
        <ol className="flex flex-wrap gap-2">
          {STOPS.map((stop, index) => (
            <li key={stop.step}>
              <a
                href={`#stop-${stop.step.toLowerCase()}`}
                className="group flex min-h-11 items-center gap-2.5 border border-ink/15 bg-paper px-3 py-1.5 text-[14px] font-semibold transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span
                  aria-hidden
                  className="display-serif grid size-6 place-items-center border border-accent text-[13px] text-accent"
                >
                  {index + 1}
                </span>
                {stop.step}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <ol className="pmds-journey mt-16">
        {STOPS.map((stop, index) => (
          <li
            key={stop.step}
            id={`stop-${stop.step.toLowerCase()}`}
            className="pmds-journey-stop scroll-mt-24"
          >
            <span aria-hidden className="pmds-journey-marker">
              {index + 1}
            </span>
            <div
              className={`grid grid-cols-1 gap-x-14 gap-y-8 ${index % 2 === 0 ? "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"}`}
            >
              <div className={index % 2 === 0 ? undefined : "lg:order-2"}>
                <p className="micro text-[12px] tracking-label text-accent">
                  Stop {index + 1} · {stop.step}
                </p>
                <h3 className="display-serif mt-3 text-[clamp(1.7rem,1.1rem+1.8vw,2.6rem)] leading-[1.08] text-balance">
                  {stop.title}
                </h3>
                <p className="mt-5 text-[17px] leading-[1.7] text-ink/85">{stop.body}</p>
                <PlainWords {...stop.plain} className="mt-7" />
              </div>
              <div className={`min-w-0 lg:pt-8 ${index % 2 === 0 ? "" : "lg:order-1"}`}>
                {stop.artifact}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
