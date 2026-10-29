import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { scramble } from "../flight/motion";
import { Caret, FileCard, Label, Mono, snap, snapIn, Stage, typedAt } from "./parts";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 14–17: "And when the agent gets something wrong, it hears about it
 * right away, not from your users." The agent wraps a bare placeholder in a
 * message; `pmds lint --json` reports the documented finding with its code
 * and help; the agent fixes the sentence and the rerun is clean. The finding,
 * message and help text are the CLI reference's own example.
 */
const LENGTH = SCENES.check.to - SCENES.check.from;
const WRONG = "<p><Trans>{total}</Trans></p>";
const RIGHT = "<p><Trans>Total: {total}</Trans></p>";
const COMMAND = "$ pmds lint src/Checkout.tsx --json --fail-on warning";
const FINDING = [
  "{",
  '  "code": "pmds/no-placeholder-only-message",',
  '  "severity": "warning",',
  '  "file": "src/Checkout.tsx",',
  '  "message": "This message contains placeholders but no translatable text.",',
  '  "help": "Move translation to the surrounding authored sentence, …"',
  "}",
];
const CLEAN = ["{", '  "summary": { "files": 1, "errors": 0, "warnings": 0 }', "}"];

const T = {
  write: 4,
  lint: cue(WORDS.wrong, "check") - 10,
  finding: cue(WORDS.wrong, "check") + 8,
  mark: cue(WORDS.hears, "check"),
  exit: cue(WORDS.rightAway, "check"),
  fix: cue(WORDS.notUsers, "check") - 6,
  rerun: cue(WORDS.notUsers, "check") + 14,
};

export function Check() {
  const frame = useCurrentFrame();
  const fixed = snap(frame, T.fix, 10);
  const clean = frame >= T.rerun;
  const lines = clean ? CLEAN : FINDING;
  const shownFrom = clean ? T.rerun + 4 : T.finding;
  return (
    <Stage length={LENGTH} ground={C.paper}>
      <AbsoluteFill style={{ padding: "110px 120px", gap: 44 }}>
        <FileCard
          name="src/Checkout.tsx"
          right={
            <Label style={{ color: C.bronze, opacity: snap(frame, T.fix) }}>edited by agent</Label>
          }
          style={snapIn(frame, 0)}
        >
          <Mono size={60}>
            {fixed > 0
              ? scramble(WRONG, RIGHT, fixed, frame, 3)
              : typedAt(WRONG, frame, T.write, 18)}
            {frame < T.write + 22 ? <Caret frame={frame} /> : null}
          </Mono>
        </FileCard>
        <FileCard
          name="terminal"
          right={
            frame >= T.exit ? (
              <Label
                style={{
                  color: clean ? C.ink : C.bronze,
                  ...snapIn(frame, clean ? T.rerun : T.exit, { y: 0 }),
                }}
              >
                {clean ? "exit 0" : "exit 4"}
              </Label>
            ) : null
          }
          style={{ flex: 1, ...snapIn(frame, T.lint - 4) }}
        >
          <Mono size={30} style={{ display: "block", color: C.slate }}>
            {typedAt(COMMAND, frame, clean ? T.rerun - 6 : T.lint, 8)}
          </Mono>
          {lines.map((line, index) => (
            <Mono
              key={line}
              size={30}
              style={{
                display: "block",
                background:
                  !clean && index === 1
                    ? `rgba(134, 96, 38, ${0.14 * snap(frame, T.mark, 6)})`
                    : undefined,
                ...snapIn(frame, shownFrom + index * 2, { x: 30, y: 0, s: 1 }),
              }}
            >
              {line}
            </Mono>
          ))}
        </FileCard>
      </AbsoluteFill>
    </Stage>
  );
}
