import { Fragment, type ReactNode } from "react";
import { AbsoluteFill, Easing, Sequence, useCurrentFrame } from "remotion";

import { CursorTrack } from "@/components/snap-cn/cursor-track";
import { TextSwap } from "@/components/snap-cn/text-swap";
import { SnapCnUIProvider } from "@/lib/snap-cn-ui";

import {
  HERO_MESSAGE,
  JOURNEY_COMPILED,
  JOURNEY_PO_TRANSLATED,
  JOURNEY_SOURCE,
  JOURNEY_TRANSFORMED,
} from "../../../site/app/data/journey";
import { SPECIMEN_LOCALES, specimenSeats } from "../../../site/app/data/specimen";
import { C, FONT } from "../brand";
import { palamedesTheme } from "../snapcn-theme";
import { BAR, BEAT } from "../timeline";
import { ease, useBrandFonts } from "../ui";
import { Camera, cameraAt, type CamKey } from "./camera";
import { arc, mix, pop, ramp, scramble, typed, type Point } from "./motion";
import { Spark, SparkFlight } from "./spark";
import { cell, Gray, Ink, lineHeight, Title, Token, Win, type WinBox } from "./stage";

/*
 * The journey as one camera flight. A single sentence is the protagonist:
 * it is lifted out of the component into the German catalog, gets its
 * translation, passes through the build where the sentence becomes an ID and
 * the translation becomes code, rides in one piece of a split catalog, and is
 * resolved back into German in the browser. Every string comes from the
 * site's tour data (real transform and compiler output); the split catalog
 * and the browser are illustrations, drawn as abstract lines.
 */
const B = (n: number, beat = 0) => n * BAR + beat * BEAT;
export const FLIGHT_BARS = 12;
export const FLIGHT_DURATION = Math.round(B(FLIGHT_BARS));

// ---- data, all from site/app/data ----
const SRC = JOURNEY_SOURCE.split("\n");
const PO = JOURNEY_PO_TRANSLATED.split("\n");
const TR = JOURNEY_TRANSFORMED.split("\n");
const CAT = JOURNEY_COMPILED.split("\n");
const row = (lines: readonly string[], index: number) => lines[index] ?? "";
const unquote = (text: string, keyword: string) => text.slice(keyword.length + 2, -1);

const EN = HERO_MESSAGE;
const PO_EN = PO.indexOf(`msgid "${EN}"`);
const PO_PL = PO.findIndex((text, index) => index > PO_EN && text.startsWith("msgid "));
const ICU = unquote(row(PO, PO_PL), "msgid");
const DE = unquote(row(PO, PO_EN + 1), "msgstr");
const DE_ICU = unquote(row(PO, PO_PL + 1), "msgstr");
const ID = /id="([^"]+)"/u.exec(JOURNEY_TRANSFORMED)?.[1] ?? "";
const PLURAL_ID = /_\("([^"]+)"/u.exec(JOURNEY_TRANSFORMED)?.[1] ?? "";

const SENT_LINE = SRC.findIndex((text) => text.includes(EN));
const SENT_COL = row(SRC, SENT_LINE).indexOf(EN);
const PLURAL_PROPS = 'one="# seat left" other="# seats left"';
const PL_LINE = SRC.findIndex((text) => text.includes(PLURAL_PROPS));
const PL_COL = row(SRC, PL_LINE).indexOf(PLURAL_PROPS);
const ID_LINE = TR.findIndex((text) => text.includes(`id="${ID}"`));
const ID_COL = row(TR, ID_LINE).indexOf(ID);
const ENTRY_LINE = CAT.findIndex((text) => text.includes(`${ID}:`));
const ENTRY_PREFIX = `  ${ID}: "`;
const GERMAN = SPECIMEN_LOCALES.find((entry) => entry.locale === "de");
const SEATS = GERMAN ? specimenSeats(GERMAN, 3) : "";

// ---- the world ----
const CODE: WinBox = { x: 300, y: 330, fontSize: 26 };
const CATALOG: WinBox = { x: 2500, y: 380, fontSize: 26 };
const COMPONENT: WinBox = { x: 4700, y: 150, fontSize: 22 };
const COMPILED: WinBox = { x: 4700, y: 720, fontSize: 22 };
const GATE = { x: 4300, y: 250, width: 90, height: 800 };
const GATE_CENTRE: Point = [GATE.x + GATE.width / 2, 600];
const SHEET = { x: 6900, y: 220, width: 860 };
const SPREAD = { dx: -260, gap: 60 };
const BROWSER = { x: 7800, y: 240, width: 1120, height: 800 };
const ADVANCE = 1233 / 2048;
const TAB: Point = [BROWSER.x + 30 + 2 * 230 + 100, BROWSER.y + 64 + 35];

const KEYS: CamKey[] = [
  { f: 0, x: 960, y: 600, z: 0.92 },
  { f: B(1, 2), x: 960, y: 570, z: 1.1, ease: Easing.inOut(Easing.cubic) },
  { f: B(2, 2), x: 960, y: 600, z: 1.04 },
  { f: B(3, 1), x: 2050, y: 520, z: 0.72 },
  { f: B(3, 3.5), x: 3080, y: 600, z: 1 },
  { f: B(5, 3.5), x: 3080, y: 560, z: 1.16, ease: Easing.inOut(Easing.cubic) },
  { f: B(6, 1), x: 3300, y: 620, z: 1 },
  { f: B(6, 3.5), x: 4250, y: 600, z: 0.92 },
  { f: B(7, 2.5), x: 5050, y: 640, z: 0.75 },
  { f: B(8, 1), x: 5070, y: 640, z: 0.77, ease: Easing.inOut(Easing.cubic) },
  { f: B(8, 3), x: 7300, y: 660, z: 0.82 },
  { f: B(9, 3.5), x: 7250, y: 660, z: 0.76, ease: Easing.inOut(Easing.cubic) },
  { f: B(10, 0.5), x: 7790, y: 650, z: 0.7 },
  { f: B(11, 0.5), x: 7800, y: 650, z: 0.71, ease: Easing.inOut(Easing.cubic) },
  { f: B(11, 3), x: BROWSER.x + 560, y: BROWSER.y + 400, z: 1.1, ease: Easing.inOut(Easing.cubic) },
];

function marked(text: string, marks: readonly string[]): ReactNode {
  const hit = marks.find((mark) => text.includes(mark));
  if (!hit) return /^\s*(\/\/|#)/u.test(text) ? <Gray>{text}</Gray> : text;
  const at = text.indexOf(hit);
  return (
    <>
      {text.slice(0, at)}
      <Ink>{hit}</Ink>
      {marked(text.slice(at + hit.length), marks)}
    </>
  );
}

// ---- 1 · write, 2 · extract ----
function Write({ f }: { f: number }) {
  const [sx, sy] = cell(CODE, SENT_LINE, SENT_COL);
  const lh = lineHeight(CODE.fontSize);
  const underline = ramp(f, B(1, 1.5), B(1, 2.5));
  return (
    <>
      <Title
        x={CODE.x}
        y={110}
        width={1500}
        kicker="1 · Write"
        text="Write the sentence, right where it's used."
        frame={f}
        at={8}
      />
      <p
        style={{
          position: "absolute",
          left: CODE.x,
          top: 260,
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 28,
          color: C.slate,
          opacity: ease(f, B(1), 14),
        }}
      >
        <span style={{ fontFamily: FONT.mono, color: C.bronze, fontWeight: 700 }}>{"<Trans>"}</span>{" "}
        is a macro: plain JSX for you, rewritten by your build.
      </p>
      <Win
        box={CODE}
        width={1320}
        label="src/TripCard.tsx"
        lines={SRC.map((text) => marked(text, ["<Trans>", "</Trans>", "<Plural"]))}
        style={{ opacity: ease(f, 0, 14), transform: `translateY(${(1 - ease(f, 0, 18)) * 40}px)` }}
      />
      <div
        style={{
          position: "absolute",
          left: sx,
          top: sy + lh - 6,
          width: EN.length * CODE.fontSize * ADVANCE * underline,
          height: 3,
          background: C.bronze,
        }}
      />
      <p
        style={{
          position: "absolute",
          left: CODE.x,
          top: 910,
          width: 560,
          margin: 0,
          padding: "16px 26px",
          border: `1.5px solid ${C.hair}`,
          background: C.listing,
          fontFamily: FONT.mono,
          fontSize: 30,
          color: C.ink,
          opacity: ease(f, B(1, 3.6), 10),
        }}
      >
        {typed("$ pmds extract", f, B(2), BEAT * 1.6)}
      </p>
    </>
  );
}

function Catalog({ f }: { f: number }) {
  const enLanded = f >= B(3, 3);
  const plLanded = f >= B(4, 0.2);
  const slot = ease(f, B(4, 0.4), 8) * (1 - ease(f, B(4, 2), 6));
  const pulse = 0.5 + 0.5 * Math.sin((f - B(4, 0.4)) * 0.35);
  const [qx, qy] = cell(CATALOG, PO_EN + 1, 7);
  const lines = PO.map((text, index) => {
    if (index === PO_EN) return enLanded ? text : 'msgid ""';
    if (index === PO_PL) return plLanded ? text : 'msgid ""';
    if (index === PO_EN + 1 || index === PO_PL + 1) {
      const german = index === PO_EN + 1 ? DE : DE_ICU;
      const start = index === PO_EN + 1 ? B(4, 2) : B(5, 0);
      return (
        <Fragment key={text}>
          msgstr "<Ink>{typed(german, f, start, index === PO_EN + 1 ? BEAT * 2.6 : BEAT * 3)}</Ink>"
        </Fragment>
      );
    }
    return marked(text, []);
  });
  return (
    <>
      <Title
        x={CATALOG.x}
        y={130}
        width={1700}
        kicker="2 · Extract"
        text="One command lifts every sentence out."
        frame={f}
        at={B(3, 0.5)}
        out={B(4, 1.5)}
      />
      <Title
        x={CATALOG.x}
        y={130}
        width={1250}
        kicker="3 · Translate"
        text="Translators fill in German. Your code stays as it is."
        frame={f}
        at={B(4, 2)}
        out={B(6, 2)}
        size={60}
      />
      <Win
        box={CATALOG}
        width={1160}
        tone="file"
        label="src/locales/de.po"
        right={
          <span
            style={{
              padding: "4px 12px",
              border: `1.5px solid ${C.bronze}`,
              color: C.bronze,
              opacity: ease(f, B(4, 2), 10),
            }}
          >
            for translators
          </span>
        }
        lines={lines}
        style={{
          opacity: ease(f, B(3), 14),
          transform: `translateY(${(1 - ease(f, B(3), 18)) * 40}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: qx - 8,
          top: qy + 4,
          width: CATALOG.fontSize * ADVANCE * 2 + 16,
          height: lineHeight(CATALOG.fontSize) - 8,
          border: `2px solid ${C.bronze}`,
          opacity: slot * (0.4 + 0.6 * pulse),
        }}
      />
    </>
  );
}

/** Scramble only the part of a line that the build changes. */
function rewrite(before: string, after: string, t: number, frame: number, seed: number): string {
  let head = 0;
  while (head < before.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const middle = scramble(
    before.slice(head, before.length - tail),
    after.slice(head, after.length - tail),
    t,
    frame,
    seed,
  );
  return before.slice(0, head) + middle + after.slice(after.length - tail);
}

// ---- 4 · build ----
function Build({ f }: { f: number }) {
  const progress = ramp(f, B(7, 0.5), B(7, 2.6), Easing.linear);
  const lines = TR.map((text, index) => {
    const before = index === 0 ? "" : row(SRC, index - 1);
    if (before === text) return marked(text, []);
    return progress >= 1
      ? marked(text, [ID, PLURAL_ID])
      : rewrite(before, text, progress, f, index + 1);
  });
  const key = scramble(EN, ID, ramp(f, B(7, 0.5), B(7, 2.4), Easing.linear), f, 40);
  const catalog = CAT.map((text, index) => {
    const shown = ease(f, B(7, 0.6) + index * 2, 8);
    if (index === ENTRY_LINE) {
      return (
        <span key={text} style={{ opacity: shown }}>
          {"  "}
          <span
            style={{ color: key === ID ? C.bronze : C.ink, fontWeight: key === ID ? 700 : 400 }}
          >
            {key}
          </span>
          : "{f >= B(7, 2.8) ? DE : ""}
          ",
        </span>
      );
    }
    return (
      // Catalog lines are unique apart from the single blank line.
      <span key={text || "blank"} style={{ opacity: shown }}>
        {marked(text, ['" Platz frei"', '" Plätze frei"'])}
      </span>
    );
  });
  const gateGlow = ease(f, B(6, 3.2), 6) * (1 - ease(f, B(7, 0.6), 10));
  const marks = ease(f, B(7, 3), 10);
  const [ix, iy] = cell(COMPONENT, ID_LINE, ID_COL);
  const [kx, ky] = cell(COMPILED, ENTRY_LINE, 2);
  const idWidth = ID.length * COMPONENT.fontSize * ADVANCE;
  const lh = lineHeight(COMPONENT.fontSize);
  const elbow = COMPONENT.x - 46;
  return (
    <>
      <Title
        x={3820}
        y={-60}
        width={2440}
        kicker="4 · Build"
        text="The build swaps each sentence for a short ID, and each translation for ready-to-run code."
        frame={f}
        at={B(6, 3)}
        out={B(8, 1.5)}
        size={54}
      />
      <div
        style={{
          position: "absolute",
          left: GATE.x,
          top: GATE.y,
          width: GATE.width,
          height: GATE.height,
          border: `2px solid ${C.ink}`,
          background: `rgba(134, 96, 38, ${0.06 + 0.22 * gateGlow})`,
          opacity: ease(f, B(6, 1.5), 12),
        }}
      >
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%) rotate(-90deg)",
            fontFamily: FONT.mono,
            fontSize: 24,
            letterSpacing: "0.3em",
            color: C.ink,
            whiteSpace: "nowrap",
          }}
        >
          YOUR BUILD
        </span>
      </div>
      <Win
        box={COMPONENT}
        width={1100}
        label="Your component after the build"
        lines={lines}
        style={{
          opacity: ease(f, B(6, 2), 14),
          transform: `translateY(${(1 - ease(f, B(6, 2), 18)) * 40}px)`,
        }}
      />
      <Win
        box={COMPILED}
        width={1100}
        tone="file"
        label="German catalog after the build"
        lines={catalog}
        style={{
          opacity: ease(f, B(6, 3), 14),
          transform: `translateY(${(1 - ease(f, B(6, 3), 18)) * 40}px)`,
        }}
      />
      {[
        [ix, iy],
        [kx, ky],
      ].map(([x = 0, y = 0]) => (
        <div
          key={`${x.toString()}-${y.toString()}`}
          style={{
            position: "absolute",
            left: x - 8,
            top: y + 3,
            width: (idWidth + 16) * marks,
            height: lh - 6,
            border: `2px solid ${C.bronze}`,
            opacity: marks,
          }}
        />
      ))}
      <svg
        width={200}
        height={1200}
        style={{ position: "absolute", left: elbow - 20, top: 0, overflow: "visible" }}
      >
        <path
          d={`M ${COMPONENT.x - elbow + 20} ${iy + lh / 2} H 20 V ${ky + lh / 2} H ${COMPONENT.x - elbow + 20}`}
          fill="none"
          stroke={C.bronze}
          strokeWidth={3}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ramp(f, B(7, 3.2), B(8, 0.4))}
        />
      </svg>
      <p
        style={{
          position: "absolute",
          left: elbow - 210,
          top: (iy + ky) / 2 + lh / 2 - 18,
          width: 180,
          margin: 0,
          textAlign: "right",
          fontFamily: FONT.mono,
          fontSize: 22,
          color: C.bronze,
          opacity: ease(f, B(8, 0.2), 10),
        }}
      >
        same ID
      </p>
    </>
  );
}

// ---- 5 · split, 6 · load ----
interface Piece {
  name: string;
  chunk: string;
  rows: readonly number[];
  real?: boolean;
}

const PIECES: readonly Piece[] = [
  { name: "Home", chunk: "home.js", rows: [0.72, 0.5, 0.86, 0.6, 0.42] },
  { name: "Search", chunk: "search.js", rows: [0.62, 0.8, 0.46, 0.7] },
  { name: "Trip details", chunk: "trip.js", rows: [0.56, 0.74], real: true },
  { name: "Checkout", chunk: "checkout.js", rows: [0.8, 0.52, 0.66, 0.7, 0.44] },
];
const JAG = 12;
const ROW = 34;
const pieceHeight = (piece: Piece) =>
  52 + (piece.rows.length + (piece.real ? 2 : 0)) * ROW + 30 + JAG * 2;
const TOPS = PIECES.reduce<number[]>((tops, piece, index) => {
  const previous = PIECES[index - 1];
  tops.push(
    index === 0 || !previous ? SHEET.y : (tops[index - 1] ?? 0) + pieceHeight(previous) - JAG,
  );
  return tops;
}, []);
const SHEET_HEIGHT = (TOPS.at(-1) ?? 0) + pieceHeight(PIECES.at(-1) ?? PIECES[0]!) - SHEET.y;
const TILT = [-1.4, 0.9, -0.6, 1.2];
const LOADS: Record<string, { start: number; end: number; slot: number } | undefined> = {
  Home: { start: B(10, 0.5), end: B(10, 2), slot: 0 },
  "Trip details": { start: B(10, 3.4), end: B(11, 0.8), slot: 1 },
};
const slotAt = (slot: number): Point => [
  BROWSER.x + 30 + slot * 360,
  BROWSER.y + BROWSER.height - 112,
];

/** A deterministic zigzag shared by two neighbouring pieces. */
function zig(edge: number, width: number): number[] {
  return Array.from({ length: Math.ceil(width / 40) + 1 }, (_, index) => {
    const value = Math.sin(edge * 91.7 + index * 12.9898) * 43_758.5453;
    return (value - Math.floor(value)) * JAG;
  });
}

function clip(index: number, height: number): string {
  const top = index === 0 ? [0] : zig(index, SHEET.width);
  const bottom = index === PIECES.length - 1 ? [JAG] : zig(index + 1, SHEET.width);
  const step = (count: number) => SHEET.width / Math.max(1, count - 1);
  const topPoints = top.map(
    (y, at) => `${(at * step(top.length)).toFixed(1)}px ${(top.length === 1 ? 0 : y).toFixed(1)}px`,
  );
  const bottomPoints = bottom
    .map(
      (y, at) =>
        `${(at * step(bottom.length)).toFixed(1)}px ${(height - JAG + (bottom.length === 1 ? JAG : y)).toFixed(1)}px`,
    )
    .reverse();
  if (top.length === 1) topPoints.push(`${SHEET.width}px 0px`);
  if (bottom.length === 1) bottomPoints.unshift(`${SHEET.width}px ${height}px`);
  return `polygon(${[...topPoints, ...bottomPoints].join(", ")})`;
}

function piecePlacement(index: number, f: number) {
  const piece = PIECES[index] ?? PIECES[0]!;
  const appear = pop(f, B(8, 2) + index * BEAT * 0.25, { damping: 16 });
  const tear = pop(f, B(9, 1) + index * 4, { damping: 15, stiffness: 110 });
  const x = SHEET.x + SPREAD.dx * tear;
  const y = (TOPS[index] ?? 0) + (index - 1.5) * SPREAD.gap * tear;
  let scale = mix(0.9, 1, appear);
  const rotate = (TILT[index] ?? 0) * tear;
  const load = LOADS[piece.name];
  let gone = 0;
  if (load) {
    const fold = ramp(f, load.start, load.start + 9, Easing.in(Easing.cubic));
    scale = mix(scale, 0.02, fold);
    gone = ramp(f, load.start + 5, load.start + 9);
  }
  return { x, y, scale, rotate, opacity: Math.min(1, appear * 1.4) * (1 - gone), tear };
}

function Pieces({ f }: { f: number }) {
  const ghosts = mix(1, 0.35, ease(f, B(9, 1), 14));
  const missing = ease(f, B(10, 1), 12);
  return (
    <>
      <Title
        x={6480}
        y={-40}
        width={2100}
        kicker="5 · Split"
        text="Then the catalog splits: one piece per screen."
        frame={f}
        at={B(8, 2.5)}
        out={B(10)}
        size={60}
      />
      <Title
        x={6480}
        y={-40}
        width={2100}
        kicker="6 · Load"
        text="Each screen loads only its own words."
        frame={f}
        at={B(10, 0.5)}
        size={60}
      />
      {["ja", "es", "fr"].map((locale, index) => {
        const depth = 3 - index;
        return (
          <div
            key={locale}
            style={{
              position: "absolute",
              left: SHEET.x + depth * 34,
              top: SHEET.y - depth * 34,
              width: SHEET.width,
              height: SHEET_HEIGHT,
              opacity: ease(f, B(8, 3), 14) * (1 - ease(f, B(9, 3.2), 18)),
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                border: `1.5px solid ${C.hair}`,
                background: C.paper,
                opacity: ghosts,
              }}
            />
            <span
              style={{
                position: "absolute",
                right: 18,
                top: 5,
                fontFamily: FONT.mono,
                fontSize: 19,
                color: C.slate,
              }}
            >
              {locale}
              {f >= B(9, 1.2) ? " · not downloaded" : ""}
            </span>
          </div>
        );
      })}
      {PIECES.map((piece, index) => {
        const place = piecePlacement(index, f);
        const height = pieceHeight(piece);
        const loads = Boolean(LOADS[piece.name]);
        const left = loads ? 0 : missing;
        return (
          <div key={piece.name}>
            <div
              style={{
                position: "absolute",
                left: place.x,
                top: place.y,
                width: SHEET.width,
                height,
                transformOrigin: "50% 50%",
                transform: `rotate(${place.rotate}deg) scale(${place.scale})`,
                clipPath: clip(index, height),
                background: C.paper,
                borderLeft: `1.5px solid ${C.hair}`,
                borderRight: `1.5px solid ${C.hair}`,
                opacity: place.opacity * mix(1, 0.5, left),
              }}
            >
              <div style={{ padding: `${JAG + 14}px 34px 0` }}>
                <p
                  style={{
                    margin: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: FONT.sans,
                    fontSize: 26,
                    fontWeight: 700,
                    color: C.ink,
                  }}
                >
                  {piece.name}
                  <span
                    style={{ fontFamily: FONT.mono, fontSize: 18, fontWeight: 400, color: C.slate }}
                  >
                    {index === 0 ? "locales/de · whole app" : ""}
                  </span>
                </p>
                <div style={{ marginTop: 14 }}>
                  {piece.real && (
                    <p
                      style={{
                        margin: 0,
                        fontFamily: FONT.mono,
                        fontSize: 20,
                        lineHeight: `${ROW.toString()}px`,
                        color: C.ink,
                      }}
                    >
                      <Ink>{ID}</Ink>: "{DE}"
                      <br />
                      <Ink>{PLURAL_ID}</Ink>: seats
                    </p>
                  )}
                  {piece.rows.map((width, rowIndex) => (
                    <span
                      // Rows of an illustration never reorder.
                      key={`${piece.name}-${rowIndex.toString()}`}
                      style={{
                        display: "block",
                        width: `${width * 100}%`,
                        height: 12,
                        margin: `${(ROW - 12) / 2}px 0`,
                        background: C.mistDeep,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <span
              style={{
                position: "absolute",
                left: SHEET.x + SPREAD.dx - 176,
                top: (TOPS[index] ?? 0) + (index - 1.5) * SPREAD.gap + JAG + 12,
                width: 150,
                padding: "8px 0",
                textAlign: "center",
                border: `1.5px solid ${C.ink}`,
                background: C.listing,
                fontFamily: FONT.mono,
                fontSize: 20,
                color: C.ink,
                opacity:
                  pop(f, B(9, 2.5) + index * 4, { damping: 14 }) *
                  (loads ? 1 - ease(f, (LOADS[piece.name]?.start ?? 0) + 4, 8) : 1),
              }}
            >
              {piece.chunk}
            </span>
            {!loads && (
              <span
                style={{
                  position: "absolute",
                  left: SHEET.x + SPREAD.dx + SHEET.width + 24,
                  top: (TOPS[index] ?? 0) + (index - 1.5) * SPREAD.gap + JAG + 18,
                  fontFamily: FONT.mono,
                  fontSize: 20,
                  color: C.gray,
                  opacity: missing,
                }}
              >
                not downloaded
              </span>
            )}
            {LOADS[piece.name] && (
              <PieceSpark f={f} index={index} load={LOADS[piece.name]} height={height} />
            )}
          </div>
        );
      })}
    </>
  );
}

/** A loaded piece travels as a spark to its place in the browser's downloads. */
function PieceSpark({
  f,
  index,
  load,
  height,
}: {
  f: number;
  index: number;
  load: { start: number; end: number; slot: number } | undefined;
  height: number;
}) {
  if (!load || f < load.start + 5 || f > load.end) return null;
  const place = piecePlacement(index, f);
  const from: Point = [place.x + SHEET.width / 2, place.y + height / 2];
  const [sx, sy] = slotAt(load.slot);
  const to: Point = [sx + 165, sy + 38];
  const t = ramp(f, load.start + 9, load.end - 8, Easing.inOut(Easing.cubic));
  const shown = Math.min(
    ramp(f, load.start + 5, load.start + 9),
    1 - ramp(f, load.end - 8, load.end - 4),
  );
  return (
    <Spark
      at={arc(from, to, t, 160)}
      turn={(f - load.start) * 9}
      size={54 * (1 + Math.sin((f - load.start) * 0.5) * 0.12)}
      opacity={shown}
    />
  );
}

const TABS = ["Home", "Search", "Trip details", "Checkout"] as const;
const SWAP_TITLE = B(11, 0.8);
const SWAP_SEATS = B(11, 1.2);
const CLICK = B(10, 3.3);

/** A line set like TextSwap sets it, for the frames before the swap begins. */
function Swapless({
  text,
  size,
  weight,
  color,
}: {
  text: string;
  size: number;
  weight: number;
  color: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT.sans,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.02em",
        color,
        textRendering: "geometricPrecision",
      }}
    >
      {text}
    </div>
  );
}

function Browser({ f, real }: { f: number; real: (frame: number) => number }) {
  const shown = pop(f, B(9, 3.2), { damping: 15 });
  const clicked = f >= CLICK;
  return (
    <div
      style={{
        position: "absolute",
        left: BROWSER.x,
        top: BROWSER.y,
        width: BROWSER.width,
        height: BROWSER.height,
        border: `2px solid ${C.ink}`,
        background: C.paper,
        opacity: Math.min(1, shown * 1.3),
        transform: `scale(${mix(0.94, 1, shown)})`,
      }}
    >
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: "0 26px",
          borderBottom: `1.5px solid ${C.hair}`,
          background: C.mist,
          fontFamily: FONT.mono,
          fontSize: 22,
          color: C.slate,
        }}
      >
        example.com/de{clicked ? "/trips/42" : ""}
      </div>
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "0 30px",
          borderBottom: `1.5px solid ${C.hair}`,
        }}
      >
        {TABS.map((tab) => {
          const active = clicked ? tab === "Trip details" : tab === "Home";
          return (
            <span
              key={tab}
              style={{
                width: 230,
                padding: "20px 0 16px",
                fontFamily: FONT.sans,
                fontSize: 24,
                fontWeight: active ? 700 : 400,
                color: active ? C.ink : C.slate,
                borderBottom: `4px solid ${active ? C.bronze : "transparent"}`,
              }}
            >
              {tab}
            </span>
          );
        })}
      </div>
      <div style={{ position: "relative", height: 470, padding: "40px 40px 0" }}>
        {clicked ? (
          <div
            lang="de"
            style={{ border: `1.5px solid ${C.hair}`, background: C.white, padding: "34px 44px" }}
          >
            {/* The ID resolves into the German sentence: one face, a shared-axis swap. */}
            <div style={{ position: "relative", height: 80 }}>
              {f < SWAP_TITLE ? (
                <Swapless text={ID} size={52} weight={700} color={C.ink} />
              ) : (
                <Sequence from={real(SWAP_TITLE)} layout="none">
                  <TextSwap
                    fromText={ID}
                    toText={DE}
                    transition="shared-axis-y"
                    fontSize={52}
                    fontWeight={700}
                    color={C.ink}
                    fontFamily={FONT.sans}
                  />
                </Sequence>
              )}
            </div>
            <div
              style={{
                position: "relative",
                width: 300,
                height: 62,
                margin: "24px auto 0",
                border: `2px solid ${C.bronze}`,
              }}
            >
              {f < SWAP_SEATS ? (
                <Swapless text={PLURAL_ID} size={30} weight={400} color={C.bronze} />
              ) : (
                <Sequence from={real(SWAP_SEATS)} layout="none">
                  <TextSwap
                    fromText={PLURAL_ID}
                    toText={SEATS}
                    transition="shared-axis-y"
                    fontSize={30}
                    fontWeight={400}
                    color={C.bronze}
                    fontFamily={FONT.sans}
                  />
                </Sequence>
              )}
            </div>
          </div>
        ) : (
          <div>
            {[0.55, 0.9, 0.8, 0.62].map((width, index) => (
              <span
                // Rows of an illustration never reorder.
                key={`home-${index.toString()}`}
                style={{
                  display: "block",
                  width: `${width * 100}%`,
                  height: index === 0 ? 40 : 16,
                  margin: index === 0 ? "0 0 36px" : "0 0 22px",
                  background: C.mistDeep,
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 150,
          borderTop: `1.5px solid ${C.hair}`,
          background: C.listing,
        }}
      >
        <p
          style={{
            margin: "12px 30px 0",
            fontFamily: FONT.mono,
            fontSize: 16,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.slate,
          }}
        >
          Downloaded
        </p>
        {[
          { label: "home.js + German", note: "with the first page", at: B(10, 2) },
          { label: "trip.js + German", note: "when you open it", at: B(11, 0.8) },
        ].map((item, slot) => (
          <div
            key={item.label}
            style={{
              position: "absolute",
              left: 30 + slot * 360,
              top: 46,
              width: 330,
              padding: "10px 16px",
              border: `1.5px solid ${C.ink}`,
              background: C.paper,
              opacity: ramp(f, item.at - 8, item.at - 4),
              transform: `scale(${mix(0.02, 1, ramp(f, item.at - 8, item.at, Easing.out(Easing.back(1.4))))})`,
            }}
          >
            <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 20, color: C.ink }}>
              {item.label}
            </span>
            <span style={{ display: "block", fontFamily: FONT.sans, fontSize: 18, color: C.slate }}>
              {item.note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Bars of the choreography above (left) mapped to bars of a longer cut
 * (right), so the flight can follow a narrator without being redrawn.
 */
export type FlightWarp = readonly (readonly [number, number])[];

function warp(frame: number, anchors: FlightWarp | undefined): number {
  if (!anchors || anchors.length < 2) return frame;
  const bar = frame / BAR;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [o0 = 0, n0 = 0] = anchors[index] ?? [];
    const [o1 = 0, n1 = 0] = anchors[index + 1] ?? [];
    if (bar <= n1 || index === anchors.length - 2) {
      return (o0 + ((o1 - o0) * (bar - n0)) / (n1 - n0)) * BAR;
    }
  }
  return frame;
}

function unwarp(frame: number, anchors: FlightWarp | undefined): number {
  if (!anchors || anchors.length < 2) return frame;
  const bar = frame / BAR;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [o0 = 0, n0 = 0] = anchors[index] ?? [];
    const [o1 = 0, n1 = 0] = anchors[index + 1] ?? [];
    if (bar <= o1 || index === anchors.length - 2) {
      return (n0 + ((n1 - n0) * (bar - o0)) / (o1 - o0)) * BAR;
    }
  }
  return frame;
}

/** A world point on screen, normalized, under the camera at a choreography frame. */
function onScreen(point: Point, frame: number): Point {
  const cam = cameraAt(KEYS, frame);
  return [((point[0] - cam.x) * cam.z + 960) / 1920, ((point[1] - cam.y) * cam.z + 540) / 1080];
}

export function JourneyFlight({ anchors }: { anchors?: FlightWarp }) {
  useBrandFonts();
  const f = warp(useCurrentFrame(), anchors);
  const camera = cameraAt(KEYS, f);
  const real = (frame: number) => Math.round(unwarp(frame, anchors));
  const walk = real(B(10, 2));
  const [sx, sy] = onScreen([BROWSER.x + 760, BROWSER.y + 640], B(10, 2));
  const [tx, ty] = onScreen(TAB, CLICK);
  const reach = real(CLICK) - walk;
  return (
    <SnapCnUIProvider theme={palamedesTheme}>
      <AbsoluteFill style={{ background: C.parchment }}>
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${C.hair} 1px, transparent 1px), linear-gradient(90deg, ${C.hair} 1px, transparent 1px)`,
            backgroundSize: `${(72 * camera.z).toFixed(2)}px ${(72 * camera.z).toFixed(2)}px`,
            backgroundPosition: `${(-camera.x * camera.z * 0.6).toFixed(1)}px ${(-camera.y * camera.z * 0.6).toFixed(1)}px`,
            opacity: 0.35,
          }}
        />
        <Camera keys={KEYS} frame={f}>
          <Write f={f} />
          <Catalog f={f} />
          <Build f={f} />
          <Browser f={f} real={real} />
          <Pieces f={f} />

          {/* 2 · the sentence and its plural leave the component as sparks */}
          <SparkFlight
            frame={f}
            from={{ at: cell(CODE, SENT_LINE, SENT_COL), fontSize: CODE.fontSize, lines: [EN] }}
            to={{ at: cell(CATALOG, PO_EN, 7), fontSize: CATALOG.fontSize, lines: [EN] }}
            start={B(2, 3)}
            end={B(3, 3)}
            lift={320}
            render={() => EN}
          />
          <SparkFlight
            frame={f}
            from={{
              at: cell(CODE, PL_LINE, PL_COL),
              fontSize: CODE.fontSize,
              lines: [PLURAL_PROPS],
            }}
            to={{ at: cell(CATALOG, PO_PL, 7), fontSize: CATALOG.fontSize, lines: [ICU] }}
            start={B(3, 0.2)}
            end={B(4, 0.2)}
            lift={220}
            render={(side) => (side === "from" ? PLURAL_PROPS : ICU)}
          />

          {/* 4 · the pair enters the build as one spark and leaves as two */}
          <SparkFlight
            frame={f}
            from={{ at: cell(CATALOG, PO_EN, 7), fontSize: CATALOG.fontSize, lines: [EN, DE] }}
            to={{ at: GATE_CENTRE, fontSize: CODE.fontSize, lines: [] }}
            start={B(6, 0.6)}
            end={B(7, 0.3)}
            lift={120}
            drop={false}
            render={() => (
              <>
                {EN}
                {"\n"}
                <span style={{ color: C.bronze }}>{DE}</span>
              </>
            )}
          />
          <SparkFlight
            frame={f}
            from={{ at: GATE_CENTRE, fontSize: CODE.fontSize, lines: [] }}
            to={{ at: cell(COMPONENT, ID_LINE, ID_COL), fontSize: COMPONENT.fontSize, lines: [ID] }}
            start={B(7, 0.4)}
            end={B(7, 2.6)}
            lift={140}
            grab={false}
            color={C.bronze}
            render={() => ID}
          />
          <SparkFlight
            frame={f}
            from={{ at: GATE_CENTRE, fontSize: CODE.fontSize, lines: [] }}
            to={{
              at: cell(COMPILED, ENTRY_LINE, ENTRY_PREFIX.length),
              fontSize: COMPILED.fontSize,
              lines: [DE],
            }}
            start={B(7, 0.5)}
            end={B(7, 2.8)}
            lift={-120}
            grab={false}
            color={C.bronze}
            render={() => DE}
          />
        </Camera>
        {/* The click, in screen space: the camera holds still while it happens. */}
        <Sequence from={walk} durationInFrames={real(B(11, 0.6)) - walk} layout="none">
          <CursorTrack
            path={[
              { at: 0, x: sx, y: sy, duration: 8 },
              { at: Math.max(10, reach - 18), x: tx, y: ty, duration: 18, click: true },
              { at: reach + 14, x: tx + 0.04, y: ty + 0.3, duration: 16 },
            ]}
          />
        </Sequence>
      </AbsoluteFill>
    </SnapCnUIProvider>
  );
}
