import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { Revealed } from "../kinetic";
import { BAR } from "../timeline";
import { arrive, Display, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * After the hook: "And the usual setup makes it harder. You invent a key for
 * every sentence. Every visitor downloads the whole language file. Message
 * syntax gets parsed at runtime, in the browser. Every framework needs its own
 * glue code. And the tools are too slow to run on every save." The same five
 * problems the homepage's before/after table names, each answered later.
 */
const PROBLEMS: readonly { cue: number; title: string; sample: ReactNode }[] = [
  { cue: at(2.75), title: "Keys nobody can invent", sample: 't("checkout.cta_v2")' },
  {
    cue: at(5.3),
    title: "One big file per language",
    sample: "de.json · every message, on every page",
  },
  {
    cue: at(8.4),
    title: "Parsed at runtime",
    sample: "{seats, plural, …} → a parser in the browser",
  },
  { cue: at(12.2), title: "Glue for every framework", sample: "loaders · providers · middleware" },
  { cue: at(15.4), title: "Tools too slow for every save", sample: "seconds per extraction run" },
];

export function Problems() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background: C.mist, padding: "130px 160px", opacity: sceneFade(frame, BAR * 7) }}
    >
      <Display size={64}>
        <Revealed text="And the usual setup makes it harder." frame={frame} at={at(0.4)} />
      </Display>
      <div style={{ marginTop: 64, borderTop: `1.5px solid ${C.hair}` }}>
        {PROBLEMS.map((problem) => (
          <div
            key={problem.title}
            style={{
              display: "grid",
              gridTemplateColumns: "620px 1fr",
              alignItems: "baseline",
              gap: 40,
              padding: "26px 0",
              borderBottom: `1.5px solid ${C.hair}`,
              ...arrive(frame, problem.cue - 4, 14, 20),
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: FONT.sans,
                fontSize: 36,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              {problem.title}
            </p>
            <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 26, color: C.slate }}>
              {problem.sample}
            </p>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}
