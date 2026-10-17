import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import {
  JOURNEY_COMPILED,
  JOURNEY_PO,
  JOURNEY_PO_TRANSLATED,
  JOURNEY_SOURCE,
  JOURNEY_TRANSFORMED,
} from "../../../site/app/data/journey";
import { SPECIMEN_LOCALES, specimenSeats } from "../../../site/app/data/specimen";
import { C, FONT } from "../brand";
import { BAR, BEAT } from "../timeline";
import { arrive, Display, ease, Kicker, Listing, sceneFade } from "../ui";

/*
 * Bars 9–14: one sentence through the toolchain, one stop per bar. The code
 * and catalog text come from the homepage data, which holds real transform
 * and compiler output, so the film never shows an invented artifact.
 */
const STOPS = [
  { step: "Write", title: "You write a sentence, not a key." },
  { step: "Extract", title: "One command finds every sentence." },
  { step: "Translate", title: "Translators get a real file." },
  { step: "Build", title: "Your build turns sentences into tiny functions." },
  { step: "Deliver", title: "Each screen loads only its own words." },
  { step: "Render", title: "Your visitor reads their language." },
] as const;

function marked(line: string, marks: readonly string[]): ReactNode {
  const hit = marks.find((mark) => line.includes(mark));
  if (!hit) {
    return /^\s*(\/\/|#)/u.test(line) ? <span style={{ color: C.gray }}>{line}</span> : line;
  }
  const at = line.indexOf(hit);
  return (
    <>
      {line.slice(0, at)}
      <span style={{ color: C.bronze, fontWeight: 700 }}>{hit}</span>
      {marked(line.slice(at + hit.length), marks)}
    </>
  );
}

function lines(code: string, marks: readonly string[]): ReactNode[] {
  return code.split("\n").map((line) => marked(line, marks));
}

/** Reveal text character by character between two frames. */
function typed(text: string, frame: number, start: number, duration: number): string {
  const count = Math.round(
    interpolate(frame, [start, start + duration], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  return text.slice(0, count);
}

function WriteStop() {
  return (
    <Listing
      label="src/TripCard.tsx — what you write"
      lines={lines(JOURNEY_SOURCE, [
        "Your trip starts tomorrow.",
        '"# seat left"',
        '"# seats left"',
      ])}
      fontSize={24}
    />
  );
}

function ExtractStop({ frame }: { frame: number }) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          padding: "18px 26px",
          border: `1.5px solid ${C.hair}`,
          background: C.listing,
          fontFamily: FONT.mono,
          fontSize: 30,
          color: C.ink,
        }}
      >
        {typed("$ pmds extract", frame, 4, 18)}
      </p>
      <div style={{ marginTop: 22, ...arrive(frame, 26) }}>
        <Listing
          label="src/locales/de.po — new, waiting for German"
          tone="file"
          lines={lines(JOURNEY_PO, ['msgstr ""'])}
          fontSize={23}
        />
      </div>
    </div>
  );
}

function TranslateStop({ frame }: { frame: number }) {
  const source = JOURNEY_PO_TRANSLATED.split("\n");
  const msgstrLines = source
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("msgstr"));
  const rendered = source.map((line, index) => {
    const order = msgstrLines.findIndex((entry) => entry.index === index);
    if (order === -1) return marked(line, []);
    const start = 6 + order * (BEAT * 1.4);
    const body = line.slice("msgstr ".length);
    return (
      <>
        {"msgstr "}
        <span style={{ color: C.bronze, fontWeight: 700 }}>
          {typed(body, frame, start, BEAT * 1.2)}
        </span>
      </>
    );
  });
  return (
    <Listing label="src/locales/de.po — translated" tone="file" lines={rendered} fontSize={23} />
  );
}

function BuildStop({ frame }: { frame: number }) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Listing
        label="Your component after the build"
        lines={lines(JOURNEY_TRANSFORMED, [
          'id="rPAYxZI1G3I"',
          'getI18n()._("vqH_FEPt0Hs", { seats })',
        ]).slice(3)}
        fontSize={19}
      />
      <div style={arrive(frame, BEAT * 1.5)}>
        <Listing
          label="The German catalog after the build"
          lines={lines(JOURNEY_COMPILED, [
            '"Deine Reise beginnt morgen."',
            '" Platz frei"',
            '" Plätze frei"',
          ])}
          fontSize={18}
        />
      </div>
    </div>
  );
}

const SCREENS = ["Home", "Search", "Trip details", "Checkout"] as const;

function DeliverStop({ frame }: { frame: number }) {
  const tripLoaded = ease(frame, BEAT * 1.5, 14);
  return (
    <div style={{ border: `1.5px solid ${C.ink}`, background: C.paper }}>
      {SCREENS.map((screen, index) => {
        const loaded = index === 0 ? 1 : screen === "Trip details" ? tripLoaded : 0;
        return (
          <div
            key={screen}
            style={{
              display: "grid",
              gridTemplateColumns: "300px 1fr",
              alignItems: "center",
              gap: 30,
              padding: "26px 30px",
              borderTop: index ? `1.5px solid ${C.hair}` : undefined,
            }}
          >
            <span
              style={{
                padding: "14px 20px",
                border: `1.5px solid ${C.ink}`,
                background: loaded > 0.5 ? C.mist : C.paper,
                fontFamily: FONT.sans,
                fontSize: 28,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              {screen}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <span
                style={{
                  width: 120,
                  height: 22,
                  border: loaded > 0.5 ? "none" : `2px dashed ${C.gray}`,
                  background: loaded > 0 ? C.bronze : "transparent",
                  opacity: loaded > 0 ? 0.35 + 0.65 * loaded : 1,
                }}
              />
              <span
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 26,
                  color: loaded > 0.5 ? C.ink : C.gray,
                }}
              >
                {index === 0
                  ? "German messages arrive with the first page"
                  : loaded > 0.5
                    ? "German messages load with this screen"
                    : "Not downloaded — nobody opened it yet"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RenderStop({ frame }: { frame: number }) {
  const german = frame >= BEAT * 1.5;
  const entry = german ? SPECIMEN_LOCALES[1] : SPECIMEN_LOCALES[0];
  const seats = frame >= BEAT * 2.75 ? 1 : 3;
  return (
    <div style={{ border: `1.5px solid ${C.ink}`, background: C.paper, padding: 44 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {SPECIMEN_LOCALES.map((item) => (
          <span
            key={item.locale}
            style={{
              padding: "10px 16px",
              border: `1.5px solid ${item.locale === entry.locale ? C.ink : "transparent"}`,
              background: item.locale === entry.locale ? C.mist : "transparent",
              fontFamily: FONT.mono,
              fontSize: 22,
              fontWeight: item.locale === entry.locale ? 700 : 400,
              color: C.ink,
            }}
          >
            {item.label}
          </span>
        ))}
      </div>
      <div
        lang={entry.locale}
        style={{
          marginTop: 34,
          padding: "40px 44px",
          border: `1.5px solid ${C.hair}`,
          background: C.white,
        }}
      >
        <p
          style={{ margin: 0, fontFamily: FONT.sans, fontSize: 52, fontWeight: 700, color: C.ink }}
        >
          {entry.title}
        </p>
        <p
          style={{
            display: "inline-block",
            margin: "26px 0 0",
            padding: "10px 18px",
            border: `2px solid ${C.bronze}`,
            fontFamily: FONT.sans,
            fontSize: 30,
            color: C.bronze,
          }}
        >
          {specimenSeats(entry, seats)}
        </p>
      </div>
    </div>
  );
}

export function Journey() {
  const frame = useCurrentFrame();
  const index = Math.min(STOPS.length - 1, Math.floor(frame / BAR));
  const local = frame - index * BAR;
  const stop = STOPS[index] ?? STOPS[0];
  const swap = interpolate(
    local,
    [0, 10, BAR - 8, BAR],
    [0, 1, 1, index === STOPS.length - 1 ? 1 : 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const artifact = [
    <WriteStop key="write" />,
    <ExtractStop key="extract" frame={local} />,
    <TranslateStop key="translate" frame={local} />,
    <BuildStop key="build" frame={local} />,
    <DeliverStop key="deliver" frame={local} />,
    <RenderStop key="render" frame={local} />,
  ][index];

  return (
    <AbsoluteFill style={{ background: C.parchment, opacity: sceneFade(frame, BAR * 6) }}>
      <div style={{ position: "absolute", left: 130, top: 120, width: 420 }}>
        <Kicker>How it works</Kicker>
        <ol style={{ margin: "56px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 22 }}>
          {STOPS.map((item, position) => {
            const current = position === index;
            const done = position < index;
            return (
              <li key={item.step} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 54,
                    height: 54,
                    border: `2px solid ${current || done ? C.bronze : C.mistDeep}`,
                    background: current ? C.paper : "transparent",
                    fontFamily: FONT.display,
                    fontSize: 26,
                    color: current || done ? C.bronze : C.slate,
                  }}
                >
                  {position + 1}
                </span>
                <span
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 32,
                    fontWeight: current ? 700 : 400,
                    color: current ? C.ink : C.slate,
                  }}
                >
                  {item.step}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div style={{ position: "absolute", left: 660, top: 110, right: 130, opacity: swap }}>
        <Display size={60} style={{ maxWidth: 1100 }}>
          {stop.title}
        </Display>
        <div style={{ marginTop: 44, transform: `translateY(${(1 - swap) * 16}px)` }}>
          {artifact}
        </div>
      </div>
    </AbsoluteFill>
  );
}
