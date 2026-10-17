import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";

import { PromptSend } from "@/components/snap-cn/prompt-send";

import { C, FONT } from "../brand";
import { Revealed } from "../kinetic";
import { BAR } from "../timeline";
import { arrive, Display, ease, Kicker, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 40–42: "Working with a coding agent? Add the Palamedes skill and
 * simply ask it to set up translations for you." The command types itself,
 * then snapcn's Prompt Send writes the homepage's prompt and sends it. The
 * scope line is the homepage's too, so nobody expects more from the skill.
 */
const COMMAND = "npx skills add sebastian-software/palamedes --skill palamedes";
const PROMPT = "Use $palamedes to set up translations in this app.";
const CUE = { command: at(1.9), handover: at(3.6), scope: at(7.2) };

/** Typing that starts slow, runs, and settles, the way Prompt Send types. */
function eased(text: string, frame: number, start: number, duration: number): string {
  const t = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const curve = t < 0.15 ? t * 0.6 : t > 0.85 ? 0.91 + (t - 0.85) * 0.6 : 0.09 + (t - 0.15) * 1.17;
  return text.slice(0, Math.round(Math.min(1, curve) * text.length));
}

export function Agent() {
  const frame = useCurrentFrame();
  const handover = ease(frame, CUE.handover - 6, 12);

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: sceneFade(frame, BAR * 3) }}>
      <AbsoluteFill style={{ padding: "150px 160px", opacity: 1 - handover }}>
        <Kicker style={arrive(frame, 0)}>With your coding agent</Kicker>
        <Display size={80} style={{ marginTop: 24 }}>
          <Revealed text="Working with a coding agent?" frame={frame} at={4} />
        </Display>
        <div style={{ marginTop: 80, ...arrive(frame, CUE.command - 8) }}>
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
              padding: "24px 32px",
              border: `1.5px solid ${C.hair}`,
              background: C.listing,
              fontFamily: FONT.mono,
              fontSize: 34,
              color: C.ink,
              whiteSpace: "pre",
            }}
          >
            {"$ "}
            {eased(COMMAND, frame, CUE.command, 34)}
          </p>
        </div>
      </AbsoluteFill>

      <Sequence from={CUE.handover - 8} layout="none">
        <AbsoluteFill style={{ opacity: handover }}>
          <PromptSend
            text={PROMPT}
            placeholder="Ask your agent…"
            chips={[]}
            radius={0}
            fontFamily={FONT.sans}
            theme={{ background: C.mist }}
            revealAt={0.05}
            typeStart={0.55}
            typeDuration={1.7}
            cutInAt={0.7}
            cutOutAt={2.35}
            cursorAt={2.4}
            clickAt={2.95}
          />
        </AbsoluteFill>
      </Sequence>

      <p
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 110,
          margin: 0,
          textAlign: "center",
          fontFamily: FONT.sans,
          fontSize: 28,
          color: C.slate,
          opacity: ease(frame, CUE.scope, 12),
        }}
      >
        Covers Next.js App Router and Vite + React, including Lingui migration.
      </p>
    </AbsoluteFill>
  );
}
