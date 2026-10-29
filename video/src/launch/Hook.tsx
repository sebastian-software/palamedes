import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { Caret, count, Label, Mono, Plus, snap, snapIn, Stage, typedAt } from "./parts";
import { CHANGES, PROMPT } from "./story";
import { SCENES } from "./timeline";

/*
 * Bars 1–4, piano alone: "Ask your agent to translate one button." The prompt
 * types and sends, and the agent's change list grows file by file on the
 * sixteenths until the screen is full. The last frames zoom into the first
 * file, which the pains open on.
 */
const LENGTH = SCENES.hook.to - SCENES.hook.from;
const SEND = 84;
const LIST = 104;
const STEP = 9;

export function Hook() {
  const frame = useCurrentFrame();
  const sent = snap(frame, SEND, 6);
  const shown = CHANGES.filter((_, index) => frame >= LIST + index * STEP).length;
  const added = CHANGES.slice(0, shown).reduce((sum, change) => sum + change.added, 0);
  const zoom = interpolate(frame, [LENGTH - 14, LENGTH], [1, 2.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage length={LENGTH} ground={C.paper}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "420px 470px" }}>
        {/* The prompt, centred, then lifted to the top once sent. */}
        <div
          style={{
            position: "absolute",
            left: 160,
            right: 160,
            top: 400,
            transform: `translateY(${-310 * sent}px) scale(${1 - 0.3 * sent})`,
            transformOrigin: "left top",
          }}
        >
          <Label style={{ fontSize: 26 }}>Coding agent</Label>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 30,
              padding: "34px 40px",
              border: `2.5px solid ${frame < SEND ? C.bronze : C.hair}`,
              background: C.white,
            }}
          >
            <span
              style={{ fontFamily: FONT.sans, fontSize: 60, color: C.ink, whiteSpace: "nowrap" }}
            >
              {typedAt(PROMPT, frame, 10, 58) || (
                <span style={{ color: C.gray }}>Ask your agent…</span>
              )}
              {frame < SEND && frame >= 10 ? <Caret frame={frame} /> : null}
            </span>
            <span
              style={{
                flex: "none",
                width: 76,
                height: 76,
                borderRadius: 999,
                background: C.bronze,
                color: C.white,
                display: "grid",
                placeItems: "center",
                fontFamily: FONT.sans,
                fontSize: 44,
                transform: `scale(${1 + 0.18 * Math.sin(Math.PI * snap(frame, SEND - 6, 8))})`,
              }}
            >
              ↑
            </span>
          </div>
        </div>

        {/* The change list. */}
        <div
          style={{
            position: "absolute",
            left: 160,
            right: 160,
            top: 300,
            opacity: snap(frame, SEND + 6, 6),
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Label style={{ fontSize: 26 }}>
              {frame < LIST ? `Working${".".repeat(1 + (Math.floor(frame / 6) % 3))}` : "Changes"}
            </Label>
            <Mono size={40}>
              {shown} {shown === 1 ? "file" : "files"} ·{" "}
              <Plus>+{count(frame, LIST, CHANGES.length * STEP, 0, added)}</Plus>
            </Mono>
          </div>
          <div
            style={{
              marginTop: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              columnGap: 60,
              borderTop: `2px solid ${C.hair}`,
            }}
          >
            {CHANGES.map((change, index) => (
              <div
                key={change.file}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "22px 0",
                  borderBottom: `2px solid ${C.hair}`,
                  ...snapIn(frame, LIST + index * STEP, { x: 40, y: 0, s: 1.04 }),
                }}
              >
                <Mono size={40}>{change.file}</Mono>
                <Mono size={40}>
                  <Plus>+{change.added}</Plus>
                  {change.removed ? (
                    <span style={{ color: C.slate }}> −{change.removed}</span>
                  ) : null}
                </Mono>
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
}
