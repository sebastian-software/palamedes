import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { scramble } from "../flight/motion";
import { count, FileCard, Label, Mono, Plus, snap, snapIn, snapOut, Stage } from "./parts";
import { ADDED, CATALOGS, FILES, GLUE, GLUE_LINES, KEYS, REMOVED } from "./story";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 5–10, the beat drops: "It invents a key, edits every language file,
 * ships a plural it never tested, and writes loader glue your framework
 * didn't need." Each clause gets its own picture on its word: a key that keeps
 * changing, six catalogs with six different keys, a plural that renders
 * wrong, a pile of glue files. Then the bill for one button.
 */
const LENGTH = SCENES.pains.to - SCENES.pains.from;
const C_EDITS = cue(WORDS.edits, "pains") - 2;
const C_SHIPS = cue(WORDS.ships, "pains") - 2;
const C_PLURAL = cue(WORDS.plural, "pains");
const C_GLUE = cue(WORDS.writesGlue, "pains") - 2;
const C_END = cue(WORDS.painsEnd, "pains");

export function Pains() {
  const frame = useCurrentFrame();
  return (
    <Stage length={LENGTH} ground={C.parchment}>
      {frame < C_EDITS + 2 ? <Key frame={frame} /> : null}
      {frame >= C_EDITS && frame < C_SHIPS + 2 ? <Catalogs frame={frame} /> : null}
      {frame >= C_SHIPS && frame < C_GLUE + 2 ? <Plural frame={frame} /> : null}
      {frame >= C_GLUE && frame < C_END + 2 ? <Glue frame={frame} /> : null}
      {frame >= C_END ? <Bill frame={frame} /> : null}
    </Stage>
  );
}

/** "invents a key": the same button, a new key on every beat. */
function Key({ frame }: { frame: number }) {
  const index = Math.floor(frame / 12);
  const from = KEYS[index % KEYS.length] ?? "";
  const to = KEYS[(index + 1) % KEYS.length] ?? "";
  const t = snap(frame - index * 12, 7, 5);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", ...snapOut(frame, C_EDITS - 3) }}
    >
      <Label style={{ fontSize: 30 }}>src/TripCard.tsx</Label>
      <div style={{ marginTop: 30 }}>
        <Mono size={112}>
          t("
          <span style={{ color: C.bronze }}>{scramble(from, to, t, frame, index)}</span>
          ")
        </Mono>
      </div>
    </AbsoluteFill>
  );
}

/** "edits every language file": six catalogs, six different keys for one button. */
function Catalogs({ frame }: { frame: number }) {
  const local = frame - C_EDITS;
  return (
    <AbsoluteFill
      style={{
        padding: "90px 140px",
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "30px 50px",
        alignContent: "center",
        ...snapOut(frame, C_SHIPS - 3),
      }}
    >
      {CATALOGS.map((catalog, index) => (
        <FileCard
          key={catalog.file}
          name={catalog.file}
          right={<Label style={{ color: C.bronze }}>+1</Label>}
          style={snapIn(local, index * 4, { y: 40 })}
        >
          <Mono size={30} style={{ display: "block", color: C.slate }}>
            {"  …"}
          </Mono>
          <Mono size={30} style={{ display: "block", background: "rgba(134, 96, 38, 0.1)" }}>
            {'  "'}
            <span style={{ color: C.bronze }}>{KEYS[index]}</span>
            {`": "${catalog.value}"`}
          </Mono>
          <Mono size={30} style={{ display: "block", color: C.slate }}>
            {"  …"}
          </Mono>
        </FileCard>
      ))}
    </AbsoluteFill>
  );
}

/** "ships a plural it never tested": the code, then what the visitor sees. */
function Plural({ frame }: { frame: number }) {
  const ring = snap(frame, C_PLURAL + 12, 6);
  return (
    <AbsoluteFill
      style={{ padding: "0 160px", justifyContent: "center", ...snapOut(frame, C_GLUE - 3) }}
    >
      <div style={snapIn(frame, C_SHIPS, { y: -30 })}>
        <FileCard name="locales/en.json">
          <Mono size={40}>
            {'"seats_left": '}
            <span style={{ color: C.bronze }}>{'"{count} seats left"'}</span>
          </Mono>
        </FileCard>
      </div>
      <div
        style={{
          marginTop: 90,
          display: "flex",
          alignItems: "baseline",
          gap: 60,
          ...snapIn(frame, C_PLURAL, { s: 1.2 }),
        }}
      >
        <span
          style={{
            fontFamily: FONT.sans,
            fontSize: 210,
            fontWeight: 500,
            color: C.ink,
            lineHeight: 1,
          }}
        >
          1 seat
          <span
            style={{
              position: "relative",
              color: C.bronze,
            }}
          >
            s
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "55%",
                width: 190 * ring,
                height: 190 * ring,
                transform: "translate(-50%, -50%)",
                border: `6px solid ${C.bronze}`,
                borderRadius: 999,
                opacity: ring,
              }}
            />
          </span>{" "}
          left
        </span>
      </div>
      <Label style={{ marginTop: 40, fontSize: 28, opacity: snap(frame, C_PLURAL + 16) }}>
        rendered for count = 1
      </Label>
    </AbsoluteFill>
  );
}

/** "writes loader glue your framework didn't need": files pile up. */
function Glue({ frame }: { frame: number }) {
  const local = frame - C_GLUE;
  const lines = count(frame, C_GLUE + 4, GLUE.length * 7 + 10, 0, GLUE_LINES);
  return (
    <AbsoluteFill style={snapOut(frame, C_END - 3)}>
      <div style={{ position: "absolute", left: 160, top: 140, ...snapIn(local, 0) }}>
        <Mono size={220} color={C.bronze} style={{ lineHeight: 1 }}>
          {lines}
        </Mono>
        <Label style={{ display: "block", fontSize: 36, marginTop: 10 }}>lines of glue code</Label>
      </div>
      {GLUE.map((change, index) => (
        <FileCard
          key={change.file}
          name={change.file}
          right={<Label style={{ color: C.bronze }}>+{change.added}</Label>}
          style={{
            position: "absolute",
            left: 700 + index * 110,
            top: 110 + index * 190,
            width: 980,
            transform: `rotate(${(index % 2 ? 1 : -1) * 1.5}deg)`,
            ...snapIn(local, 6 + index * 7, { x: 260, y: 0, s: 1 }),
          }}
        >
          {GLUE_SNIPPETS[index]?.map((line) => (
            <Mono key={line} size={30} style={{ display: "block", color: C.slate }}>
              {line}
            </Mono>
          ))}
        </FileCard>
      ))}
    </AbsoluteFill>
  );
}

const GLUE_SNIPPETS = [
  [
    "export function I18nProvider({ locale, …",
    "  const [messages, setMessages] = …",
    "  useEffect(() => { load(locale) …",
  ],
  [
    "export async function load(locale) {",
    "  const res = await fetch(`/locales/…",
    "  return parse(await res.json())",
  ],
  [
    "export function middleware(req) {",
    "  const locale = negotiate(req.headers…",
    "  return rewrite(`/${locale}${…",
  ],
  [
    "export const config = {",
    '  locales: ["en", "de", "fr", …],',
    '  fallback: "en", namespaces: […',
  ],
];

/** The bill for one button. */
function Bill({ frame }: { frame: number }) {
  const local = frame - C_END;
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", ...snapOut(frame, LENGTH - 6, 6) }}
    >
      <span
        style={{
          fontFamily: FONT.display,
          fontSize: 150,
          color: C.ink,
          ...snapIn(local, 0, { s: 1.15 }),
        }}
      >
        One button.
      </span>
      <div style={{ marginTop: 50, ...snapIn(local, 10) }}>
        <Mono size={64}>
          {count(frame, C_END + 10, 24, 0, FILES)} files changed ·{" "}
          <Plus>+{count(frame, C_END + 10, 24, 0, ADDED)}</Plus>{" "}
          <span style={{ color: C.slate }}>−{REMOVED}</span>
        </Mono>
      </div>
    </AbsoluteFill>
  );
}
