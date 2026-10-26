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
 * in the word-order card the German words travel into their German places;
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

/**
 * Word order: the German words first stand in the English order, then move to
 * where German puts them. Each token keeps its identity, so the eye can follow
 * "morgen" travelling to the front.
 */
const ORDER = {
  en: "Your trip starts tomorrow.",
  tokens: [
    { from: "Deine", to: "deine", at: 0, goal: 2, lead: false },
    { from: "Reise", to: "Reise.", at: 1, goal: 3, lead: false },
    { from: "beginnt", to: "beginnt", at: 2, goal: 1, lead: false },
    { from: "morgen.", to: "Morgen", at: 3, goal: 0, lead: true },
  ],
} as const;

const MONO = 24;
const ADVANCE = (1233 / 2048) * MONO;
const CARD = 540;

/** Left edge, in px, of the word at `slot` when the words are laid out in that order. */
function slotX(words: readonly string[], slot: number): number {
  return words.slice(0, slot).reduce((x, word) => x + (word.length + 1) * ADVANCE, 0);
}

function Reorder({ frame, start }: { frame: number; start: number }) {
  const before = [...ORDER.tokens].sort((l, r) => l.at - r.at).map((t) => t.from);
  const after = [...ORDER.tokens].sort((l, r) => l.goal - r.goal).map((t) => t.to);
  return (
    <span style={{ position: "relative", display: "inline-block", width: 420, height: MONO * 1.2 }}>
      {ORDER.tokens.map((token) => {
        const t = ramp(frame, start, start + 26);
        const x =
          slotX(before, token.at) + (slotX(after, token.goal) - slotX(before, token.at)) * t;
        // Words moving right arc above the line, words moving left dip below it,
        // so no two words ever cross on the same path.
        const right = token.goal > token.at;
        const y = (right ? -16 : token.lead ? 30 : 14) * Math.sin(Math.PI * t);
        return (
          <span
            key={token.from}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              transform: `translateY(${y.toFixed(2)}px)`,
              fontFamily: FONT.mono,
              fontSize: MONO,
              color: token.lead && t > 0 ? C.bronze : C.ink,
              whiteSpace: "pre",
            }}
          >
            {t < 0.5 ? token.from : token.to}
          </span>
        );
      })}
    </span>
  );
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
          <div style={{ height: 28 }} />
          <Row tag="DE" lit={two}>
            <Reorder frame={frame} start={CUE.order + 10} />
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
