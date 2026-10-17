import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { SPECIMEN_LOCALES, specimenSeats } from "../../../site/app/data/specimen";
import { C, FONT } from "../brand";
import { ramp } from "../flight/motion";
import { Revealed } from "../kinetic";
import { BAR } from "../timeline";
import { arrive, Display, ease, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 3–8, the hook: "Translating an app looks simple, until you spend a
 * minute on the details. One seat, but three seats. Words that change their
 * order. Prices and dates that every language writes its own way. And that's
 * with just two languages." Each detail gets a card with English above German;
 * plural forms come from the site's specimen, formats are real Intl output.
 */
const CUE = {
  title: at(0.3),
  details: at(2.3),
  plural: at(4.9),
  three: at(5.9),
  order: at(7.1),
  formats: at(9),
  two: at(12.4),
};

const ENGLISH = SPECIMEN_LOCALES.find((entry) => entry.locale === "en");
const GERMAN = SPECIMEN_LOCALES.find((entry) => entry.locale === "de");
const seats = (count: number) => [
  ENGLISH ? specimenSeats(ENGLISH, count) : "",
  GERMAN ? specimenSeats(GERMAN, count) : "",
];

const money = (locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(1234.5);
const day = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 9, 18)),
  );
const FORMATS = [`${money("en-US")} · ${day("en-US")}`, `${money("de-DE")} · ${day("de-DE")}`];

/** Word order: the same sentence in both languages, with the words that belong together. */
const ORDER = {
  en: "Your trip starts tomorrow.",
  de: "Morgen beginnt deine Reise.",
  pairs: [
    ["Your", "deine"],
    ["trip", "Reise."],
    ["starts", "beginnt"],
    ["tomorrow.", "Morgen"],
  ],
} as const;

const MONO = 24;
const ADVANCE = (1233 / 2048) * MONO;
const CARD = 540;

function wordCentre(sentence: string, word: string): number {
  const start = sentence.indexOf(word);
  return (start + word.length / 2) * ADVANCE;
}

function Card({
  frame,
  cue,
  title,
  children,
}: {
  frame: number;
  cue: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: CARD,
        padding: "36px 34px 42px",
        border: `1.5px solid ${C.hair}`,
        background: C.paper,
        ...arrive(frame, cue - 4, 14, 30),
      }}
    >
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 28, fontWeight: 700, color: C.ink }}>
        {title}
      </p>
      <div style={{ marginTop: 30 }}>{children}</div>
    </div>
  );
}

function Row({ tag, lit, children }: { tag: string; lit: number; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
      <span
        style={{
          width: 40,
          fontFamily: FONT.mono,
          fontSize: 20,
          fontWeight: 700,
          color: lit > 0.5 ? C.bronze : C.slate,
        }}
      >
        {tag}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: MONO, color: C.ink, whiteSpace: "pre" }}>
        {children}
      </span>
    </div>
  );
}

export function Details() {
  const frame = useCurrentFrame();
  const three = frame >= CUE.three;
  const [en, de] = seats(three ? 3 : 1);
  const swap = ease(frame, CUE.three, 8);
  const links = ramp(frame, CUE.order + 10, CUE.order + 34);
  const two = ease(frame, CUE.two, 10);

  return (
    <AbsoluteFill
      style={{ background: C.mist, padding: "150px 120px", opacity: sceneFade(frame, BAR * 6) }}
    >
      <Display size={64}>
        <Revealed text="Translating an app looks simple." frame={frame} at={CUE.title} />
      </Display>
      <Display size={64} style={{ marginTop: 6, color: C.bronze }}>
        <Revealed text="Until you spend a minute on the details." frame={frame} at={CUE.details} />
      </Display>

      <div style={{ display: "flex", gap: 30, marginTop: 100 }}>
        <Card frame={frame} cue={CUE.plural} title="One seat, three seats">
          <Row tag="EN" lit={0}>
            <span style={{ opacity: 0.4 + 0.6 * (three ? swap : 1) }}>{en}</span>
          </Row>
          <div style={{ height: 28 }} />
          <Row tag="DE" lit={two}>
            <span
              style={{ color: three ? C.bronze : C.ink, opacity: 0.4 + 0.6 * (three ? swap : 1) }}
            >
              {de}
            </span>
          </Row>
        </Card>

        <Card frame={frame} cue={CUE.order} title="Words change their order">
          <Row tag="EN" lit={0}>
            {ORDER.en}
          </Row>
          <div style={{ position: "relative", height: 80 }}>
            <svg
              width={CARD}
              height={80}
              style={{ position: "absolute", left: 58, top: 0, overflow: "visible" }}
            >
              {ORDER.pairs.map(([from, to], index) => (
                <line
                  key={from}
                  x1={wordCentre(ORDER.en, from)}
                  y1={6}
                  x2={
                    wordCentre(ORDER.en, from) +
                    (wordCentre(ORDER.de, to) - wordCentre(ORDER.en, from)) *
                      ramp(links, index * 0.12, index * 0.12 + 0.6)
                  }
                  y2={6 + 66 * ramp(links, index * 0.12, index * 0.12 + 0.6)}
                  stroke={from === "tomorrow." ? C.bronze : C.slate}
                  strokeWidth={from === "tomorrow." ? 3 : 1.5}
                  opacity={links > 0 ? 1 : 0}
                />
              ))}
            </svg>
          </div>
          <Row tag="DE" lit={two}>
            {ORDER.de}
          </Row>
        </Card>

        <Card frame={frame} cue={CUE.formats} title="Prices and dates">
          <Row tag="EN" lit={0}>
            {FORMATS[0]}
          </Row>
          <div style={{ height: 28 }} />
          <Row tag="DE" lit={two}>
            <span style={{ color: C.bronze, ...arrive(frame, CUE.formats + 14, 12, 10) }}>
              {FORMATS[1]}
            </span>
          </Row>
        </Card>
      </div>

      <p
        style={{
          margin: "70px 0 0",
          fontFamily: FONT.display,
          fontSize: 50,
          color: C.ink,
          opacity: two,
          transform: `translateY(${(1 - two) * 16}px)`,
        }}
      >
        And that's with just <span style={{ color: C.bronze }}>two</span> languages.
      </p>
    </AbsoluteFill>
  );
}
