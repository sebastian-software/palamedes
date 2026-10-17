import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";

import { PromptSend } from "@/components/snap-cn/prompt-send";

import { C, FONT } from "../brand";
import { Revealed } from "../kinetic";
import { BAR } from "../timeline";
import { arrive, Display, ease, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 41–43: "Working with a coding agent? Add the Palamedes skill and
 * simply ask it to set up translations for you." The command types itself,
 * then snapcn's Prompt Send writes the homepage's prompt below it and sends it. The
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

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: sceneFade(frame, BAR * 3) }}>
      <AbsoluteFill style={{ padding: "130px 160px" }}>
        <Display size={70}>
          <Revealed text="Working with a coding agent?" frame={frame} at={4} />
        </Display>
        <div style={{ marginTop: 64, ...arrive(frame, CUE.command - 8) }}>
          <p
            style={{
              margin: 0,
              fontFamily: FONT.sans,
              fontSize: 28,
              fontWeight: 600,
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

      <p
        style={{
          position: "absolute",
          left: 160,
          top: 540,
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 28,
          fontWeight: 600,
          color: C.slate,
          ...arrive(frame, CUE.handover - 8),
        }}
      >
        Then ask
      </p>
      {/* Prompt Send paints no page of its own here and sits below the command. */}
      <Sequence from={CUE.handover - 8} layout="none">
        <AbsoluteFill style={{ transform: "translateY(190px)" }}>
          <PromptSend
            text={PROMPT}
            placeholder="Ask your agent…"
            chips={[]}
            radius={0}
            // 742 stage px is 1600 frame px: the composer lines up with the command.
            width={742}
            fontFamily={FONT.sans}
            theme={{ background: "transparent" }}
            revealAt={0.05}
            typeStart={0.55}
            typeDuration={1.7}
            // No cuts: the whole composer stays in frame.
            cutInAt={99}
            cutOutAt={99}
            cursorAt={2.4}
            clickAt={2.95}
          />
        </AbsoluteFill>
      </Sequence>

      <p
        style={{
          position: "absolute",
          left: 160,
          bottom: 110,
          margin: 0,
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
