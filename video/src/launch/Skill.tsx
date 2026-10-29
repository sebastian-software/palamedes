import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { Caret, FileCard, Label, Mono, snap, snapIn, Stage, typedAt } from "./parts";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 28–31, the second drop: "Add the skill, and ask for translations."
 * The install command types itself, the agent prompt follows and is sent.
 * What the skill does and the hosts it covers come from docs/agent-skill.md,
 * so nobody expects more from it.
 */
const LENGTH = SCENES.skill.to - SCENES.skill.from;
const COMMAND = "$ npx skills add sebastian-software/palamedes --skill palamedes";
const PROMPT = "Use the Palamedes skill to set up translations in this app.";
const DOES = [
  "Detects the host and your locale policy",
  "Keeps existing translations and context",
  "Verifies rendered output in two locales",
];
const T = {
  command: cue(WORDS.skill, "skill") - 18,
  prompt: cue(WORDS.ask, "skill") - 4,
  send: cue(WORDS.ask, "skill") + 46,
};

export function Skill() {
  const frame = useCurrentFrame();
  const sent = frame >= T.send;
  return (
    <Stage length={LENGTH} ground={C.mist}>
      <AbsoluteFill style={{ padding: "120px 140px", gap: 50 }}>
        <FileCard name="terminal" style={snapIn(frame, 0)}>
          <Mono size={40}>
            {typedAt(COMMAND, frame, T.command, 24)}
            {frame < T.prompt ? <Caret frame={frame} /> : null}
          </Mono>
        </FileCard>
        <div style={snapIn(frame, T.prompt - 4)}>
          <Label style={{ fontSize: 26 }}>Coding agent</Label>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 30,
              padding: "30px 36px",
              border: `2.5px solid ${sent ? C.hair : C.bronze}`,
              background: C.white,
            }}
          >
            <span
              style={{ fontFamily: FONT.sans, fontSize: 48, color: C.ink, whiteSpace: "nowrap" }}
            >
              {typedAt(PROMPT, frame, T.prompt, 40)}
              {!sent && frame >= T.prompt ? <Caret frame={frame} /> : null}
            </span>
            <span
              style={{
                flex: "none",
                width: 68,
                height: 68,
                borderRadius: 999,
                background: C.bronze,
                color: C.white,
                display: "grid",
                placeItems: "center",
                fontFamily: FONT.sans,
                fontSize: 40,
                transform: `scale(${1 + 0.2 * Math.sin(Math.PI * snap(frame, T.send - 4, 8))})`,
              }}
            >
              ↑
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gap: 22 }}>
          {DOES.map((line, index) => (
            <div
              key={line}
              style={{
                display: "flex",
                gap: 24,
                alignItems: "baseline",
                ...snapIn(frame, T.send + 10 + index * 6, { x: 30, y: 0, s: 1 }),
              }}
            >
              <span style={{ fontFamily: FONT.mono, fontSize: 40, color: C.bronze }}>✓</span>
              <span style={{ fontFamily: FONT.sans, fontSize: 44, color: C.ink }}>{line}</span>
            </div>
          ))}
          <Label style={{ fontSize: 24, marginTop: 10, opacity: snap(frame, T.send + 34) }}>
            Next.js App Router · Vite with React · migration from Lingui
          </Label>
        </div>
      </AbsoluteFill>
    </Stage>
  );
}
