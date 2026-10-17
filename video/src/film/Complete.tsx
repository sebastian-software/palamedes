import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { SPECIMEN_LOCALES, specimenSeats } from "../../../site/app/data/specimen";
import { C, FONT } from "../brand";
import { ramp } from "../flight/motion";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, ease, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 28–33: "And it doesn't stop there." Four cards arrive as the voice
 * names them, then one rail joins them from the first sentence to the last
 * translation. Formats are real Intl output for German; the CLI cards show
 * the commands and what docs/cli.md says they do, with no invented output.
 */
const CUE = {
  plurals: at(2.3),
  numbers: at(3.1),
  dates: at(3.6),
  server: at(4.5),
  actions: at(5.5),
  lint: at(6.9),
  audit: at(8.6),
  toolchain: at(11.9),
  first: at(13.9),
  last: at(15.1),
};

const GERMAN = SPECIMEN_LOCALES.find((entry) => entry.locale === "de");
const PRICE = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(1234.5);
const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "UTC" }).format(
  new Date(Date.UTC(2026, 9, 18)),
);

function Card({
  frame,
  cue,
  title,
  children,
  lit,
}: {
  frame: number;
  cue: number;
  title: string;
  children: ReactNode;
  lit: number;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: 372,
        height: 360,
        padding: "30px 30px 0",
        border: `1.5px solid ${C.hair}`,
        borderTop: `4px solid ${lit > 0.5 ? C.bronze : C.hair}`,
        background: C.paper,
        ...arrive(frame, cue - 4, 12, 30),
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 30,
          fontWeight: 700,
          lineHeight: 1.15,
          color: C.ink,
        }}
      >
        {title}
      </p>
      <div style={{ marginTop: 24 }}>{children}</div>
    </div>
  );
}

const Line = ({ frame, cue, children }: { frame: number; cue: number; children: ReactNode }) => (
  <p
    style={{
      margin: "0 0 12px",
      fontFamily: FONT.sans,
      fontSize: 25,
      color: C.ink,
      ...arrive(frame, cue - 3, 10, 12),
    }}
  >
    {children}
  </p>
);

const Command = ({ text, note }: { text: string; note: string }) => (
  <>
    <p
      style={{
        margin: 0,
        padding: "12px 16px",
        border: `1.5px solid ${C.hair}`,
        background: C.listing,
        fontFamily: FONT.mono,
        fontSize: 24,
        color: C.ink,
      }}
    >
      $ {text}
    </p>
    <p
      style={{
        margin: "16px 0 0",
        fontFamily: FONT.sans,
        fontSize: 22,
        lineHeight: 1.4,
        color: C.slate,
      }}
    >
      {note}
    </p>
  </>
);

export function Complete() {
  const frame = useCurrentFrame();
  const rail = ramp(frame, CUE.toolchain, CUE.toolchain + 40);
  const lit = (index: number) => (rail * 4 > index + 0.5 ? 1 : 0);

  return (
    <AbsoluteFill
      style={{
        background: C.parchment,
        padding: "100px 150px",
        opacity: sceneFade(frame, BAR * 6),
      }}
    >
      <Display size={64}>
        <Revealed text="And it doesn't stop there." frame={frame} at={4} />
      </Display>

      <div style={{ display: "flex", gap: 32, marginTop: 70 }}>
        <Card
          frame={frame}
          cue={CUE.plurals}

          title="Plurals, numbers, dates"
          lit={lit(0)}
        >
          <Line frame={frame} cue={CUE.plurals}>
            {GERMAN ? `${specimenSeats(GERMAN, 1)} · ${specimenSeats(GERMAN, 3)}` : ""}
          </Line>
          <Line frame={frame} cue={CUE.numbers}>
            {PRICE}
          </Line>
          <Line frame={frame} cue={CUE.dates}>
            {DATE}
          </Line>
        </Card>
        <Card
          frame={frame}
          cue={CUE.server}

          title="Server rendering, server actions"
          lit={lit(1)}
        >
          <Line frame={frame} cue={CUE.server}>
            HTML arrives translated
          </Line>
          <Line frame={frame} cue={CUE.server + 8}>
            Hydration keeps the words
          </Line>
          <Line frame={frame} cue={CUE.actions}>
            Server actions reply in German
          </Line>
        </Card>
        <Card
          frame={frame}
          cue={CUE.lint}

          title="A linter for your messages"
          lit={lit(2)}
        >
          <Command text="pmds lint" note="Checks how messages are written in your source." />
        </Card>
        <Card
          frame={frame}
          cue={CUE.audit}

          title="An audit for every catalog"
          lit={lit(3)}
        >
          <Command
            text="pmds audit"
            note="Finds missing translations, fuzzy markers and ICU issues."
          />
        </Card>
      </div>

      {/* one toolchain, from the first sentence to the last translation */}
      <div style={{ position: "relative", marginTop: 54, height: 80 }}>
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: (372 * 4 + 32 * 3) * rail,
            height: 4,
            background: C.bronze,
          }}
        />
        <p
          style={{
            position: "absolute",
            left: 0,
            top: 22,
            margin: 0,
            fontFamily: FONT.mono,
            fontSize: 22,
            color: C.bronze,
            opacity: ease(frame, CUE.first - 4, 10),
          }}
        >
          ← the first sentence
        </p>
        <p
          style={{
            position: "absolute",
            left: (372 * 4 + 32 * 3) / 2,
            top: 22,
            margin: 0,
            transform: "translateX(-50%)",
            fontFamily: FONT.display,
            fontSize: 34,
            color: C.ink,
            opacity: ease(frame, CUE.toolchain, 12),
          }}
        >
          One toolchain
        </p>
        <p
          style={{
            position: "absolute",
            right: 0,
            top: 22,
            margin: 0,
            fontFamily: FONT.mono,
            fontSize: 22,
            color: C.bronze,
            opacity: ease(frame, CUE.last - 4, 10),
          }}
        >
          the last translation →
        </p>
      </div>
    </AbsoluteFill>
  );
}
