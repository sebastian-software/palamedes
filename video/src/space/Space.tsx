import { Fragment, type ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import {
  BENCH_REALISTIC,
  displayBenchmarkFactor,
  displayBenchmarkTime,
} from "../../../site/app/data/bench";
import { SnapCnUIProvider } from "@/lib/snap-cn-ui";

import { C, FONT } from "../brand";
import { pop, scramble } from "../flight/motion";
import { steady } from "../kinetic";
import { Caret, Mono, snap, typedAt } from "../launch/parts";
import { CORNER } from "../launch/Reveal";
import { CHANGES } from "../launch/story";
import { ROWS } from "../scenes/Wiring";
import { palamedesTheme } from "../snapcn-theme";
import { FPS } from "../timeline";
import { useBrandFonts, VersionBadge } from "../ui";
import { At, Line, type Shot, type Vec, World } from "./camera";
import { DrawnLogo } from "./DrawnLogo";
import { Bokeh, Dust, motes } from "./field";
import { Added, BookButton, Dot, File, Mark, Prompt } from "./things";
import { at, SCENES, SPACE_DURATION, WORDS } from "./timeline";

/*
 * The launch film as one calm journey through one space. The agent's work
 * gathers around the button it was asked to translate; one roll through the
 * button turns the keyed line into a sentence; the camera cranes up to the
 * mark and the frameworks it is wired for, flies through the mark into the
 * lint check, slides across to the stopwatch, dives to the skill, and flies
 * through the send button to the end. Each move is a different one, and the
 * camera holds still and square on whatever the voice is talking about. The
 * voice and score come from audio/cues/space.json; every cue is a word in it.
 */
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---- places ---------------------------------------------------------------- */
const HOME: Vec = [0, 0, 0];
const PAGE: Vec = [0, 0, -3000];
const CODE: Vec = [0, 0, -6000];
const RING: Vec = [0, -2600, -8600];
// The glue gets its own place, one floor below the button.
const GLUE_AT: Vec = [0, 1500, -3400];
const CHECK: Vec = [0, -2600, -12_600];
const DIAL: Vec = [3600, -2600, -13_000];
const SKILL: Vec = [1800, 0, -15_600];

const DUST = motes(2400, { min: [-3000, -5000, -26_000], max: [6500, 3200, 3000] }, 7);
const BOKEH = motes(300, { min: [-2600, -4400, -26_000], max: [6000, 2600, 2000] }, 19);

/* ---- cues (film frames) ----------------------------------------------------- */
const SEND = 84;
const KEY = at(WORDS.key);
const COPIES = at(WORDS.copies);
const LOADERS = at(WORDS.loaders);
const WRITES = at(WORDS.writes);
const LOT = at(WORDS.lot);
const SHOULDERS = SCENES.reveal.from;
const ROLL = { from: at(WORDS.palamedes) - 10, to: at(WORDS.palamedes) + 22 };
const ERASE = { from: at(WORDS.keys), to: at(WORDS.keys) + 26 };
const WRITE = { from: at(WORDS.writesSentence) - 6, frames: 20 };
const SETTLE = at(WORDS.sentence) + 6;
const LAND = SCENES.ring.from;
const LIB_CUES: Readonly<Record<string, number>> = {
  react: at(WORDS.react),
  vue: at(WORDS.vue),
  svelte: at(WORDS.svelte),
  solid: at(WORDS.solid),
};
const HOSTS_FROM = at(WORDS.frameworks);
const WRONG_AT = SCENES.check.from + 12;
const SCAN = at(WORDS.wrong) - 6;
const FLAG = at(WORDS.hears);
const FIX = at(WORDS.notUsers) - 6;
const CLEAN = at(WORDS.notUsers) + 16;
const RACE = at(WORDS.files) + 6;
const FACTOR = at(WORDS.seconds) + 8;
const COMMAND = at(WORDS.skill) - 18;
const ASK = at(WORDS.ask) - 4;
const ASK_SEND = at(WORDS.ask) + 46;
const END_IN = SCENES.end.from;
const COMPANY = SCENES.makers.from;

/* ---- measuring a prompt, so the camera can fly into one of its parts --------- */
let ruler: CanvasRenderingContext2D | null = null;
function textWidth(text: string, size: number): number {
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler) return text.length * size * 0.5;
  ruler.font = `${size}px ${FONT.sans}`;
  return ruler.measureText(text).width;
}
function promptPoints(text: string, word: string, size: number) {
  const border = 2.5;
  const width = 2 * border + 1.4 * size + textWidth(text, size) + 30 + 1.3 * size;
  const before = text.slice(0, text.indexOf(word));
  return {
    word: -width / 2 + border + 0.7 * size + textWidth(before, size) + textWidth(word, size) / 2,
    send: width / 2 - border - 0.7 * size - 0.65 * size,
  };
}

const HOOK_SIZE = 56;
const ASK_SIZE = 44;
const ASK_TEXT = "Use the Palamedes skill to set up translations in this app.";
const ASK_AT = add(SKILL, [0, 170, -320]);
const DIAL_AT = add(DIAL, [-380, 0, 0]);

/** The end lies straight behind the skill's send button, so the camera can fly through it. */
function endPoint(): Vec {
  const send = add(ASK_AT, [promptPoints(ASK_TEXT, "Palamedes", ASK_SIZE).send, 0, 0]);
  return add(send, [0, 0, -3600]);
}

/* ---- the flight ------------------------------------------------------------- */
function shots(end: Vec): Shot[] {
  const makers = add(end, [0, -1600, -2200]);
  return [
    // the prompt comes out of the depth
    { f: 0, at: HOME, dist: 4200, yaw: -4, pitch: 2 },
    { f: 50, at: HOME, dist: 1800, yaw: -1 },
    { f: SEND + 8, at: HOME, dist: 1600 },
    // straight on to the page it names
    { f: SEND + 40, at: PAGE, dist: 1500 },
    { f: KEY - 4, at: PAGE, dist: 1250 },
    // a slow pull back and sideways as the agent's work piles up around it
    { f: KEY + 30, at: add(PAGE, [-160, -20, 0]), dist: 1950 },
    { f: COPIES + 24, at: add(PAGE, [0, -20, 0]), dist: 2350 },
    // down a floor to the glue it writes on top
    { f: WRITES + 2, at: lerp(PAGE, GLUE_AT, 0.5), dist: 1600, pitch: 14 },
    { f: LOADERS + 14, at: GLUE_AT, dist: 1500 },
    { f: LOT - 4, at: GLUE_AT, dist: 1420 },
    // back far enough to see both: a lot of code for one page
    { f: LOT + 26, at: [0, 650, -3200], dist: 3100 },
    { f: SHOULDERS, at: [0, 620, -3200], dist: 2950 },
    // the one roll: into the page, out at its code
    { f: ROLL.from, at: PAGE, dist: 1450, roll: 0 },
    { f: ROLL.to, at: CODE, dist: 1550, roll: 360 },
    { f: SCENES.reveal.to - 10, at: CODE, dist: 1350, roll: 360 },
    // crane up to the mark on the drop
    { f: LAND + 4, at: lerp(CODE, RING, 0.5), dist: 1400, pitch: -22, roll: 360 },
    { f: LAND + 22, at: RING, dist: 1500, pitch: 4, roll: 360 },
    { f: HOSTS_FROM - 14, at: RING, dist: 1700, yaw: -5, pitch: 6, roll: 360 },
    { f: SCENES.ring.to - 10, at: RING, dist: 2250, yaw: 4, pitch: 8, roll: 360 },
    // through the mark into the check
    { f: SCENES.check.from + 22, at: CHECK, dist: 1600, roll: 360 },
    { f: SCENES.check.to - 16, at: add(CHECK, [0, -60, 0]), dist: 1450, roll: 360 },
    // a slide across to the stopwatch
    { f: SCENES.fast.from + 14, at: DIAL, dist: 1650, roll: 360 },
    { f: SCENES.fast.to - 12, at: DIAL, dist: 1450, roll: 360 },
    // a dive down to the skill
    { f: SCENES.fast.to + 6, at: lerp(DIAL, SKILL, 0.5), dist: 1500, pitch: 24, roll: 360 },
    { f: SCENES.skill.from + 30, at: add(SKILL, [0, 0, -100]), dist: 1550, roll: 360 },
    { f: ASK_SEND + 30, at: add(SKILL, [0, 30, -200]), dist: 1500, roll: 360 },
    // aim at the send button, then through it to the end
    { f: SCENES.skill.to - 14, at: end, dist: 4500, roll: 360 },
    { f: END_IN + 22, at: end, dist: 1300, roll: 360 },
    { f: COMPANY - 14, at: end, dist: 1180, roll: 360 },
    // rise to the people who make it
    { f: COMPANY + 24, at: makers, dist: 1400, roll: 360 },
    { f: SPACE_DURATION, at: makers, dist: 1320, roll: 360 },
  ];
}

export function PalamedesSpace() {
  useBrandFonts();
  const frame = useCurrentFrame();
  const out = interpolate(frame, [SPACE_DURATION - 18, SPACE_DURATION], [0, 1], clamp);
  const end = endPoint();
  return (
    <SnapCnUIProvider theme={palamedesTheme}>
      <AbsoluteFill style={{ background: C.paper, ...steady }}>
        <World shots={shots(end)} frame={frame} ground={C.paper}>
          <Dust points={DUST} />
          <Bokeh points={BOKEH} />
          <Hook frame={frame} />
          <Work frame={frame} />
          <Sentence frame={frame} />
          <Ring frame={frame} />
          <Check frame={frame} />
          <Race frame={frame} />
          <Skill frame={frame} />
          <Finale frame={frame} end={end} />
          <Makers frame={frame} end={end} />
        </World>
        <CornerMark frame={frame} />
        <AbsoluteFill style={{ background: C.paper, opacity: out }} />
      </AbsoluteFill>
    </SnapCnUIProvider>
  );
}

/* ---- hook: the prompt ------------------------------------------------------- */
const PAGE_PROMPT = "Translate the booking page into German.";

function Hook({ frame }: { frame: number }) {
  if (frame >= SEND + 40) return null;
  return (
    <At p={HOME} edge={false} opacity={1 - snap(frame, SEND + 6, 14)}>
      <Prompt
        text={typedAt(PAGE_PROMPT, frame, 10, 58)}
        placeholder="Ask your agent…"
        caret={frame < SEND && frame >= 10 ? <Caret frame={frame} /> : null}
        sendPulse={snap(frame, SEND - 6, 8)}
        active={frame < SEND}
        size={HOOK_SIZE}
      />
    </At>
  );
}

/* ---- pains: what the agent builds for one page ------------------------------ */
/*
 * A dramatized key-based setup for one small page: a key made up for every
 * string, the keys copied into three catalogs, and the loader glue to wire
 * it up. Three languages are enough to make the point.
 */
const STRINGS = [
  { key: "booking.title", tag: "h1", en: "Your trip", de: "Deine Reise", fr: "Votre voyage" },
  { key: "booking.checkin_lbl", tag: "dt", en: "Check-in", de: "Anreise", fr: "Arrivée" },
  { key: "total_v2", tag: "dt", en: "Total", de: "Gesamt", fr: "Total" },
  { key: "cta.book", tag: "button", en: "Book", de: "Buchen", fr: "Réserver" },
] as const;
const LANGS = ["en", "de", "fr"] as const;
const GLUE_FILES = CHANGES.filter((change) => change.glue);
const WORK_FILES = 1 + LANGS.length + GLUE_FILES.length;
const WORK_ADDED =
  STRINGS.length * (1 + LANGS.length) + GLUE_FILES.reduce((sum, change) => sum + change.added, 0);
const STRING_AT = at(WORDS.key);
const STEP_KEY = 6;

/** The booking page the agent was asked to translate; keys pin on as it makes them up. */
function BookingPage({ frame }: { frame: number }) {
  const pin = (index: number) => snap(frame, STRING_AT + index * STEP_KEY, 6);
  const tagged = (index: number, node: ReactNode) => (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}
    >
      {node}
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 20,
          color: C.bronze,
          border: `2px solid ${C.gold}`,
          borderRadius: 999,
          padding: "4px 12px",
          background: C.paper,
          whiteSpace: "nowrap",
          opacity: pin(index),
          transform: `translateX(${(1 - pin(index)) * 30}px)`,
        }}
      >
        {STRINGS[index]?.key}
      </span>
    </div>
  );
  const label = { fontFamily: FONT.sans, fontSize: 28, color: C.slate } as const;
  const value = { fontFamily: FONT.sans, fontSize: 28, color: C.ink, fontWeight: 600 } as const;
  return (
    <div
      style={{
        width: 640,
        background: C.white,
        border: `2px solid ${C.hair}`,
        borderRadius: 18,
        boxShadow: "0 30px 70px rgba(14, 42, 77, 0.12)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 8, padding: "14px 18px", background: C.listing }}>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            style={{ width: 12, height: 12, borderRadius: 999, background: C.mistDeep }}
          />
        ))}
      </div>
      <div style={{ display: "grid", gap: 22, padding: "30px 40px 36px" }}>
        {tagged(
          0,
          <span style={{ fontFamily: FONT.sans, fontSize: 44, fontWeight: 700, color: C.ink }}>
            Your trip
          </span>,
        )}
        {tagged(
          1,
          <span style={{ display: "flex", gap: 16 }}>
            <span style={label}>Check-in</span>
            <span style={value}>Mar 12</span>
          </span>,
        )}
        {tagged(
          2,
          <span style={{ display: "flex", gap: 16 }}>
            <span style={label}>Total</span>
            <span style={value}>€480</span>
          </span>,
        )}
        {tagged(3, <BookButton scale={0.7} />)}
      </div>
    </div>
  );
}

function Work({ frame }: { frame: number }) {
  if (frame < SEND || frame >= ROLL.to + 10) return null;
  const page = pop(frame, SEND + 14);
  const away = snap(frame, SHOULDERS + 6, 30);
  const keys = frame >= STRING_AT;
  const langsShown = LANGS.filter((_, i) => frame >= COPIES + i * 8).length;
  const glueShown = GLUE_FILES.filter((_, i) => frame >= LOADERS + i * 9);
  const shown = (keys ? 1 : 0) + langsShown + glueShown.length;
  const added =
    (keys ? STRINGS.length : 0) +
    langsShown * STRINGS.length +
    glueShown.reduce((sum, change) => sum + change.added, 0);
  const heavy = snap(frame, LOT, 8) * (1 - away);
  // The clutter clears away when the voice offers broader shoulders.
  const drift = (p: Vec): Vec => {
    const rel = [p[0] - PAGE[0], p[1] - (p[1] > 900 ? GLUE_AT[1] : PAGE[1])];
    return add(p, [(rel[0] ?? 0) * 0.8 * away, (rel[1] ?? 0) * 0.8 * away, 1800 * away]);
  };
  const fade = 1 - away;
  return (
    <>
      <At p={PAGE} scale={0.7 + 0.3 * page} opacity={Math.min(1, page * 1.5)} edge={false}>
        <BookingPage frame={frame} />
      </At>
      <At
        p={add(PAGE, [0, 300, 0])}
        edge={false}
        opacity={snap(frame, COPIES) * fade}
        scale={1 + 0.35 * heavy}
      >
        <Mono size={34} color={heavy > 0.5 ? C.bronze : C.slate}>
          {shown} {shown === 1 ? "file" : "files"} changed · <Added n={added} /> −{STRINGS.length}
        </Mono>
      </At>
      {keys ? (
        <At
          p={drift(add(PAGE, [-900, -40, 0]))}
          opacity={snap(frame, STRING_AT, 8) * fade}
          scale={0.9 + 0.1 * snap(frame, STRING_AT, 8)}
          edge={false}
        >
          <File name="BookingPage.tsx" width={560} badge={<Added n={STRINGS.length} />}>
            <div style={{ display: "grid", gap: 6 }}>
              {STRINGS.map((string, index) => (
                <Mono
                  key={string.key}
                  size={24}
                  style={{ opacity: snap(frame, STRING_AT + index * STEP_KEY, 6) }}
                >
                  t("<span style={{ color: C.bronze }}>{string.key}</span>")
                </Mono>
              ))}
            </div>
          </File>
        </At>
      ) : null}
      {LANGS.map((lang, i) => {
        const from = COPIES + i * 8;
        if (frame < from) return null;
        return (
          <At
            key={lang}
            p={drift(add(PAGE, [880, -300 + i * 250, 0]))}
            opacity={snap(frame, from, 8) * fade}
            scale={0.9 + 0.1 * snap(frame, from, 8)}
            edge={false}
          >
            <File name={`${lang}.json`} width={520} badge={<Added n={STRINGS.length} />}>
              <div style={{ display: "grid", gap: 2 }}>
                {STRINGS.map((string) => (
                  <Mono key={string.key} size={20}>
                    <span style={{ color: C.bronze }}>"{string.key}"</span>: "{string[lang]}"
                  </Mono>
                ))}
              </div>
            </File>
          </At>
        );
      })}
      {frame >= LOADERS ? (
        <At
          p={drift(add(GLUE_AT, [0, -400, 0]))}
          opacity={snap(frame, LOADERS, 8) * fade}
          edge={false}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
            <Mono size={96} color={C.bronze} style={{ lineHeight: 1 }}>
              {glueShown.reduce((sum, change) => sum + change.added, 0)}
            </Mono>
            <Mono size={34} color={C.slate}>
              lines of glue code
            </Mono>
          </div>
        </At>
      ) : null}
      {GLUE_FILES.map((change, i) => {
        const from = LOADERS + i * 9;
        if (frame < from) return null;
        return (
          <At
            key={change.file}
            p={drift(add(GLUE_AT, [(i % 2 ? 1 : -1) * 280, i < 2 ? -110 : 170, 0]))}
            opacity={snap(frame, from, 8) * fade}
            scale={0.9 + 0.1 * snap(frame, from, 8)}
            edge={false}
          >
            <File
              name={change.file.replace("src/i18n/", "")}
              width={500}
              badge={<Added n={change.added} />}
              bars={[0.9, 0.6, 0.8, 0.45]}
            />
          </At>
        );
      })}
    </>
  );
}

/* ---- reveal: no keys, just the sentences ------------------------------------ */
const OLD_LINES = STRINGS.map((string) => `<${string.tag}>{t("${string.key}")}</${string.tag}>`);
const NEW_LINES = STRINGS.map(
  (string) => `<${string.tag}><Trans>${string.en}</Trans></${string.tag}>`,
);

function Sentence({ frame }: { frame: number }) {
  if (frame < ROLL.from || frame >= SCENES.ring.from + 30) return null;
  const settled = snap(frame, SETTLE, 6);
  const lines = STRINGS.map((string, index) => {
    const kept = `<${string.tag}>`.length;
    const old = OLD_LINES[index] ?? "";
    const erased = interpolate(
      frame,
      [ERASE.from + index * 3, ERASE.to + index * 3],
      [old.length, kept],
      clamp,
    );
    const from = WRITE.from + index * 5;
    return frame < from
      ? old.slice(0, Math.round(erased))
      : typedAt(NEW_LINES[index] ?? "", frame, from, WRITE.frames);
  });
  return (
    <>
      <At p={add(CODE, [0, -240, 0])} edge={false}>
        <span style={{ position: "relative", display: "inline-block" }}>
          <Mono size={40} style={{ opacity: 1 - settled }}>
            {WORK_FILES} files changed · <Added n={WORK_ADDED} /> −{STRINGS.length}
          </Mono>
          <Mono size={40} style={{ position: "absolute", left: 0, top: 0, opacity: settled }}>
            1 file changed · <Added n={STRINGS.length} /> −{STRINGS.length}
          </Mono>
        </span>
      </At>
      <At p={CODE} edge={false}>
        <div
          style={{
            width: 1180,
            padding: "40px 52px",
            border: `2.5px solid ${settled > 0.5 ? C.bronze : C.hair}`,
            background: C.listing,
            display: "grid",
            gap: 6,
          }}
        >
          {lines.map((line, index) => (
            <Mono key={STRINGS[index]?.key} size={46} style={{ display: "block", minHeight: 62 }}>
              {colourTrans(line)}
            </Mono>
          ))}
        </div>
      </At>
    </>
  );
}

function colourTrans(text: string): ReactNode {
  return text.split(/(<\/?Trans>?)/u).map((part, index) =>
    part.startsWith("<Trans") || part.startsWith("</Trans") ? (
      <span key={`${part}-${index.toString()}`} style={{ color: C.bronze }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/* ---- the mark, and the frameworks it is wired for --------------------------- */
const LIBRARIES = ROWS[0]?.flatMap((group) => group.marks) ?? [];
const HOSTS = ROWS.slice(1).flatMap((row) => row.flatMap((group) => group.marks));
const TILT = (60 * Math.PI) / 180;
const onRing = (radius: number, angle: number): Vec => [
  RING[0] + radius * Math.cos(angle),
  RING[1] + radius * Math.sin(angle) * Math.cos(TILT),
  RING[2] + radius * Math.sin(angle) * Math.sin(TILT),
];

/** A line from the rim of the mark to just short of a framework mark. */
function spoke(p: Vec, gap: number): { from: Vec; to: Vec } {
  const flat = Math.hypot(p[0] - RING[0], p[1] - RING[1]) || 1;
  const from = add(RING, [((p[0] - RING[0]) / flat) * 128, ((p[1] - RING[1]) / flat) * 128, 0]);
  const d: Vec = [p[0] - from[0], p[1] - from[1], p[2] - from[2]];
  const length = Math.hypot(...d) || 1;
  return {
    from,
    to: add(p, [(-d[0] / length) * gap, (-d[1] / length) * gap, (-d[2] / length) * gap]),
  };
}

function Ring({ frame }: { frame: number }) {
  if (frame < SCENES.reveal.to - 30 || frame >= SCENES.check.from + 24) return null;
  const spin = (frame - LAND) * 0.002;
  const name = snap(frame, LAND + 6, 8) * (1 - snap(frame, (LIB_CUES.react ?? 0) - 16, 10));
  return (
    <>
      <At p={RING} edge={false}>
        <DrawnLogo t={interpolate(frame, [LAND - 2, LAND + 40], [0, 1], clamp)} size={240} />
      </At>
      <At p={add(RING, [0, 230, 0])} edge={false} opacity={name}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <span
            style={{
              paddingLeft: "0.28em",
              fontFamily: FONT.display,
              fontSize: 72,
              letterSpacing: "0.28em",
              color: C.ink,
            }}
          >
            PALAMEDES
          </span>
          <VersionBadge size={28} />
        </div>
      </At>
      <At
        p={RING}
        rotate={[60, 0, 0]}
        edge={false}
        opacity={snap(frame, HOSTS_FROM - 10, 20) * 0.6}
      >
        <div
          style={{ width: 2300, height: 2300, borderRadius: 999, border: `3px solid ${C.hair}` }}
        />
      </At>
      {LIBRARIES.map((mark, index) => {
        const cue = LIB_CUES[mark.id] ?? HOSTS_FROM;
        if (frame < cue - 2) return null;
        const corner = (index / LIBRARIES.length) * Math.PI * 2 + Math.PI / 4 + spin;
        const p = add(RING, [560 * Math.cos(corner), 320 * Math.sin(corner), 200]);
        const t = pop(frame, cue - 2);
        return (
          <Fragment key={mark.id}>
            <Line
              {...spoke(p, 150)}
              color={C.bronze}
              width={3}
              progress={snap(frame, cue, 8)}
              opacity={0.6}
            />
            <At p={p} scale={0.3 + 0.7 * t}>
              <Mark mark={mark} scale={5} size={54} />
            </At>
          </Fragment>
        );
      })}
      {HOSTS.map((mark, index) => {
        const cue = HOSTS_FROM + index * 4;
        if (frame < cue) return null;
        const p = onRing(1150, (index / HOSTS.length) * Math.PI * 2 + spin * 0.6);
        const t = pop(frame, cue);
        return (
          <Fragment key={mark.id}>
            <Line
              {...spoke(p, 95)}
              color={C.slate}
              width={2}
              progress={snap(frame, cue, 10)}
              opacity={0.3}
            />
            <At p={p} scale={0.3 + 0.7 * t} extent={90}>
              <Mark mark={mark} scale={3.4} size={42} />
            </At>
          </Fragment>
        );
      })}
    </>
  );
}

/* ---- check: the agent hears about it right away ----------------------------- */
const WRONG = "<p><Trans>{total}</Trans></p>";
const RIGHT = "<p><Trans>Total: {total}</Trans></p>";

function Check({ frame }: { frame: number }) {
  if (frame < SCENES.ring.to - 20 || frame >= SCENES.fast.from + 30) return null;
  const fixed = snap(frame, FIX, 12);
  const scan = interpolate(frame, [SCAN, SCAN + 18], [0, 1], clamp);
  const flag = snap(frame, FLAG, 6) * (1 - snap(frame, FIX, 6));
  const clean = snap(frame, CLEAN, 6);
  const typed =
    fixed > 0 ? scramble(WRONG, RIGHT, fixed, frame, 3) : typedAt(WRONG, frame, WRONG_AT, 18);
  return (
    <>
      <At p={CHECK} edge={false}>
        <div
          style={{
            position: "relative",
            width: 1400,
            padding: "70px 64px",
            background: C.listing,
            border: `2.5px solid ${flag > 0.5 ? C.bronze : C.hair}`,
          }}
        >
          <Mono size={56}>
            {typed}
            {frame < WRONG_AT + 22 ? <Caret frame={frame} /> : null}
          </Mono>
          {/* The lint pass sweeping the line. */}
          {scan > 0 && scan < 1 ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${scan * 98}%`,
                width: 10,
                background: C.bronze,
                opacity: 0.6,
                boxShadow: `0 0 40px 10px rgba(188, 138, 69, 0.35)`,
              }}
            />
          ) : null}
          {/* The placeholder-only message: {total} is circled. */}
          <div
            style={{
              position: "absolute",
              left: 64 + 10 * 56 * 0.602 - 16,
              top: 70 - 6,
              width: 7 * 56 * 0.602 + 32,
              height: 56 * 1.35 + 12,
              border: `5px solid ${C.bronze}`,
              borderRadius: 999,
              opacity: flag,
              transform: `scale(${1.3 - 0.3 * flag})`,
            }}
          />
        </div>
      </At>
      <At p={add(CHECK, [0, -250, 60])} edge={false} opacity={flag}>
        <Tag tone={FAIL} mark="✗">
          pmds lint: no translatable text
        </Tag>
      </At>
      <At p={add(CHECK, [0, -250, 60])} edge={false} opacity={clean}>
        <Tag tone={PASS} mark="✓">
          pmds lint
        </Tag>
      </At>
    </>
  );
}

/* A finding and a pass, in muted tones that sit with the brand palette. */
const FAIL = "#a3402f";
const PASS = "#2f7a4f";

function Tag({ children, tone, mark }: { children: ReactNode; tone: string; mark: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "14px 30px 14px 14px",
        borderRadius: 999,
        background: C.white,
        border: `3px solid ${tone}`,
        fontFamily: FONT.mono,
        fontSize: 34,
        color: C.ink,
        whiteSpace: "nowrap",
        boxShadow: "0 20px 50px rgba(14, 42, 77, 0.12)",
      }}
    >
      <span
        style={{
          width: 52,
          height: 52,
          borderRadius: 999,
          background: tone,
          color: C.white,
          display: "grid",
          placeItems: "center",
          fontFamily: FONT.sans,
          fontWeight: 700,
          fontSize: 32,
        }}
      >
        {mark}
      </span>
      {children}
    </div>
  );
}

/* ---- fast: a stopwatch, at real speed --------------------------------------- */
/*
 * Palamedes against the tools that do the same job (extract and update the
 * catalogs), unnamed: the point is the fraction of time, not a rival. Each
 * ring fills at 1:1 speed from the site's checked benchmark data. All rings
 * lie in one plane, square to the camera, so the dial reads true.
 */
const SAME_JOB = BENCH_REALISTIC.rows
  .filter((row) => row.accent || row.sameScope)
  .sort((left, right) => left.medianMs - right.medianMs);
const [OURS, NEXT] = SAME_JOB;
const OTHERS = SAME_JOB.filter((row) => !row.accent);
const SLOWEST = Math.max(...OTHERS.map((row) => row.medianMs));
const FASTEST_OTHER = Math.min(...OTHERS.map((row) => row.medianMs));

function Dial({ elapsed }: { elapsed: number }) {
  const size = 760;
  const c = size / 2;
  const rings = [
    ...OTHERS.map((row, index) => ({ row, r: 230 + index * 42, stroke: 16, color: C.slate })),
    ...(OURS ? [{ row: OURS, r: 150, stroke: 24, color: C.bronze }] : []),
  ];
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {rings.map(({ row, r, stroke, color }) => {
        const t = Math.min(1, elapsed / row.medianMs);
        const around = 2 * Math.PI * r;
        return (
          <g key={row.tool}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={C.mistDeep} strokeWidth={stroke} />
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={around}
              strokeDashoffset={around * (1 - t)}
              transform={`rotate(-90 ${c} ${c})`}
              opacity={t > 0 ? 1 : 0}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Race({ frame }: { frame: number }) {
  if (!OURS || !NEXT || frame < SCENES.check.to - 30 || frame >= SCENES.skill.from + 20) {
    return null;
  }
  const elapsed = Math.max(0, ((frame - RACE) / FPS) * 1000);
  return (
    <>
      <At p={DIAL_AT} edge={false}>
        <Dial elapsed={elapsed} />
      </At>
      <At p={add(DIAL_AT, [0, 0, 2])} edge={false}>
        <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
          <Mono size={58} color={C.bronze} style={{ fontWeight: 700 }}>
            {displayBenchmarkTime(Math.min(elapsed, OURS.medianMs))}
          </Mono>
          <span style={{ fontFamily: FONT.sans, fontSize: 26, fontWeight: 600, color: C.bronze }}>
            Palamedes
          </span>
        </div>
      </At>
      <At p={add(DIAL, [440, -130, 0])} edge={false} opacity={snap(frame, RACE + 10, 8)}>
        <div style={{ display: "grid", gap: 10, width: 640 }}>
          <Mono size={110} color={C.ink} style={{ lineHeight: 1 }}>
            {displayBenchmarkTime(Math.min(elapsed, SLOWEST))}
          </Mono>
          <Mono size={28} color={C.slate}>
            other tools, same job: {displayBenchmarkTime(FASTEST_OTHER)} to{" "}
            {displayBenchmarkTime(SLOWEST)}
          </Mono>
        </div>
      </At>
      <At
        p={add(DIAL, [440, 150, 0])}
        edge={false}
        opacity={snap(frame, FACTOR, 5)}
        scale={1.25 - 0.25 * pop(frame, FACTOR)}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 24, width: 640 }}>
          <span
            style={{
              fontFamily: FONT.sans,
              fontWeight: 800,
              fontSize: 170,
              color: C.bronze,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {displayBenchmarkFactor(NEXT, OURS.medianMs)}
          </span>
          <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 64, color: C.ink }}>
            faster
          </span>
        </div>
      </At>
    </>
  );
}

/* ---- skill: the call to action --------------------------------------------- */
const INSTALL = "$ npx skills add sebastian-software/palamedes --skill palamedes";

function Skill({ frame }: { frame: number }) {
  if (frame < SCENES.fast.to - 20 || frame >= SCENES.end.from + 10) return null;
  const sent = frame >= ASK_SEND;
  return (
    <>
      <At p={add(SKILL, [0, -170, 0])} edge={false}>
        <div
          style={{ padding: "30px 40px", background: C.listing, border: `2.5px solid ${C.hair}` }}
        >
          <Mono size={30}>
            {typedAt(INSTALL, frame, COMMAND, 24)}
            {frame < ASK ? <Caret frame={frame} /> : null}
          </Mono>
        </div>
      </At>
      <At p={ASK_AT} edge={false} opacity={snap(frame, ASK - 6, 6)}>
        <Prompt
          text={typedAt(ASK_TEXT, frame, ASK, 40)}
          caret={!sent && frame >= ASK ? <Caret frame={frame} /> : null}
          sendPulse={snap(frame, ASK_SEND - 4, 8)}
          active={!sent}
          size={ASK_SIZE}
        />
      </At>
    </>
  );
}

/* ---- the end, built in depth ------------------------------------------------ */
/** Arrive from further down the axis, settling on its place. */
function arriving(frame: number, from: number, p: Vec): { p: Vec; opacity: number } {
  const t = interpolate(frame, [from, from + 16], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  return { p: add(p, [0, 0, -900 * (1 - t)]), opacity: t };
}

function Finale({ frame, end }: { frame: number; end: Vec }) {
  if (frame < END_IN - 20 || frame >= COMPANY + 30) return null;
  const name = arriving(frame, END_IN + 8, add(end, [0, -80, 60]));
  const claim = arriving(frame, END_IN + 14, add(end, [0, 50, 0]));
  const domain = arriving(frame, at(WORDS.domain) - 4, add(end, [0, 180, -80]));
  const badge = arriving(frame, at(WORDS.version) - 8, add(end, [0, 260, -110]));
  return (
    <>
      <At edge={false} p={add(end, [0, -250, 120])}>
        <DrawnLogo t={interpolate(frame, [END_IN + 4, END_IN + 44], [0, 1], clamp)} size={190} />
      </At>
      <At edge={false} p={name.p} opacity={name.opacity}>
        <span
          style={{
            paddingLeft: "0.28em",
            fontFamily: FONT.display,
            fontSize: 48,
            letterSpacing: "0.28em",
            color: C.ink,
          }}
        >
          PALAMEDES
        </span>
      </At>
      <At edge={false} p={claim.p} opacity={claim.opacity}>
        <span
          style={{ fontFamily: FONT.display, fontSize: 76, color: C.ink, whiteSpace: "nowrap" }}
        >
          Just write <span style={{ color: C.bronze }}>the sentence.</span>
        </span>
      </At>
      <At edge={false} p={domain.p} opacity={domain.opacity}>
        <span style={{ fontFamily: FONT.mono, fontSize: 40, color: C.ink }}>palamedes.dev</span>
      </At>
      <At edge={false} p={badge.p} opacity={badge.opacity}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontFamily: FONT.sans,
            fontSize: 24,
            color: C.slate,
            whiteSpace: "nowrap",
          }}
        >
          <VersionBadge size={20} />
          <span>Open source · MIT OR Apache-2.0</span>
        </div>
      </At>
    </>
  );
}

/**
 * Who makes it, and who to ask for help with it: two cards of one height on
 * one plane, so their tops line up, each with its logo first.
 */
function Makers({ frame, end }: { frame: number; end: Vec }) {
  if (frame < COMPANY - 10) return null;
  const makers = add(end, [0, -1600, -2200]);
  const text = {
    margin: 0,
    fontFamily: FONT.sans,
    fontSize: 24,
    color: C.slate,
    whiteSpace: "nowrap",
  } as const;
  const card = {
    boxSizing: "border-box",
    height: 250,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background: C.white,
    border: `2px solid ${C.hair}`,
    padding: "44px 48px 40px",
    boxShadow: "0 30px 70px rgba(14, 42, 77, 0.10)",
  } as const;
  const left = arriving(frame, COMPANY + 8, add(makers, [-415, 0, 0]));
  const right = arriving(frame, COMPANY + 16, add(makers, [280, 0, 0]));
  return (
    <>
      <At edge={false} p={left.p} opacity={left.opacity}>
        <div style={{ ...card, width: 520 }}>
          <Img
            src={staticFile("company/sebastian-software.svg")}
            style={{ display: "block", width: 340 }}
          />
          <div>
            <p style={text}>The team behind Palamedes</p>
            <p style={{ ...text, marginTop: 6, color: C.ink }}>oss.sebastian-software.com</p>
          </div>
        </div>
      </At>
      <At edge={false} p={right.p} opacity={right.opacity}>
        <div style={{ ...card, width: 790 }}>
          <Img
            src={staticFile("company/sebastian-consulting.svg")}
            style={{ display: "block", width: 340 }}
          />
          <div>
            <p style={text}>TypeScript, React, Rust, and agentic software development.</p>
            <p style={{ ...text, marginTop: 6, color: C.ink }}>sebastian-consulting.com</p>
          </div>
        </div>
      </At>
    </>
  );
}

/** The emblem kept as a footnote through the proof. */
function CornerMark({ frame }: { frame: number }) {
  if (frame < SCENES.check.from || frame >= SCENES.skill.to) return null;
  return (
    <Img
      src={staticFile("logo.svg")}
      style={{
        position: "absolute",
        right: CORNER.right,
        bottom: CORNER.bottom,
        width: CORNER.size,
        height: CORNER.size,
        opacity: snap(frame, SCENES.check.from + 20, 8) * (1 - snap(frame, SCENES.skill.to - 6, 6)),
      }}
    />
  );
}
