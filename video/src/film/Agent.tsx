import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { typed } from "../flight/motion";
import { BAR } from "../timeline";
import { arrive, Display, ease, Kicker, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 38–40: "Working with a coding agent? Add the Palamedes skill and
 * simply ask it to set up translations for you." The command and the prompt
 * are the homepage's own; so is the scope line, so nobody expects more.
 */
const COMMAND = "npx skills add sebastian-software/palamedes --skill palamedes";
const PROMPT = "Use $palamedes to set up translations in this app.";
const CUE = { command: at(2), prompt: at(4.2), scope: at(6.2) };

export function Agent() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background: C.mist, padding: "120px 160px", opacity: sceneFade(frame, BAR * 3) }}
    >
      <Kicker style={arrive(frame, 0)}>With your coding agent</Kicker>
      <Display size={76} style={{ marginTop: 24, ...arrive(frame, 4) }}>
        Working with a coding agent?
      </Display>

      <div style={{ marginTop: 70, width: 1400, ...arrive(frame, CUE.command - 8) }}>
        <p
          style={{
            margin: 0,
            fontFamily: FONT.mono,
            fontSize: 18,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.slate,
          }}
        >
          Add the skill
        </p>
        <p
          style={{
            margin: "14px 0 0",
            padding: "22px 30px",
            border: `1.5px solid ${C.hair}`,
            background: C.listing,
            fontFamily: FONT.mono,
            fontSize: 32,
            color: C.ink,
            whiteSpace: "pre",
          }}
        >
          {"$ "}
          {typed(COMMAND, frame, CUE.command, 30)}
        </p>
      </div>

      <div style={{ marginTop: 44, width: 1400, ...arrive(frame, CUE.prompt - 8) }}>
        <p
          style={{
            margin: 0,
            fontFamily: FONT.mono,
            fontSize: 18,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.slate,
          }}
        >
          Then ask
        </p>
        <p
          style={{
            margin: "14px 0 0",
            padding: "24px 30px",
            borderLeft: `4px solid ${C.bronze}`,
            background: C.paper,
            fontFamily: FONT.sans,
            fontSize: 40,
            fontWeight: 600,
            color: C.ink,
          }}
        >
          {typed(PROMPT, frame, CUE.prompt, 34)}
        </p>
      </div>

      <p
        style={{
          margin: "36px 0 0",
          fontFamily: FONT.sans,
          fontSize: 26,
          color: C.slate,
          opacity: ease(frame, CUE.scope, 12),
        }}
      >
        Covers Next.js App Router and Vite + React, including Lingui migration.
      </p>
    </AbsoluteFill>
  );
}
