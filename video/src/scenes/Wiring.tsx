import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, ease, sceneFade } from "../ui";

/*
 * Framework integration. Each mark arrives as the narration names it, grouped
 * the way the homepage integration band groups them. Marks are the site's
 * unmodified compact assets at the site's proportions (FrameworkIdentity),
 * scaled up together, always with the visible name. Support levels stay off
 * screen, so the film outlives them.
 */
export interface IntegrationMark {
  id: string;
  name: string;
  /** File in public/logos and its display size at 1×, as on the site. */
  asset: string;
  w: number;
  h: number;
  /** Slot width at 1× for a horizontal mark; the others share a 32 px square. */
  slot?: number;
}

const SCALE = 1.6;

export type IntegrationGroup = { label: string; marks: readonly IntegrationMark[] };

// The homepage technology stripe's groups (IntegrationBand), three rows deep so
// every name stays readable at film distance. The film names the UI libraries
// before the frameworks that host them, so the story builds. Build tools stay
// off screen: they come with the frameworks.
export const ROWS: readonly (readonly IntegrationGroup[])[] = [
  [
    {
      label: "UI Libraries",
      marks: [
        { id: "react", name: "React", asset: "react.svg", w: 28, h: 26 },
        { id: "solid", name: "Solid", asset: "solid.svg", w: 26, h: 24 },
        { id: "vue", name: "Vue", asset: "vue.svg", w: 25, h: 23 },
        { id: "svelte", name: "Svelte", asset: "svelte.svg", w: 20, h: 24 },
      ],
    },
  ],
  [
    {
      label: "Frameworks",
      marks: [
        { id: "nextjs", name: "Next.js", asset: "nextjs-icon.svg", w: 24, h: 24 },
        { id: "nuxt", name: "Nuxt", asset: "nuxt.svg", w: 34, h: 34 },
        { id: "sveltekit", name: "SvelteKit", asset: "svelte.svg", w: 20, h: 24 },
        { id: "tanstack", name: "TanStack Start", asset: "tanstack-icon.svg", w: 24, h: 24 },
        {
          id: "react-router",
          name: "React Router",
          asset: "react-router-icon.svg",
          w: 30,
          h: 20,
        },
        { id: "waku", name: "Waku", asset: "waku-icon.png", w: 26, h: 26 },
        { id: "remix", name: "Remix", asset: "remix-icon.svg", w: 30, h: 18 },
      ],
    },
  ],
  [
    {
      label: "Backends",
      marks: [
        { id: "hono", name: "Hono", asset: "hono.svg", w: 24, h: 26 },
        { id: "express", name: "Express", asset: "express-icon.svg", w: 24, h: 24 },
      ],
    },
    {
      label: "CLI",
      marks: [{ id: "nodejs", name: "Node.js CLI", asset: "nodejs.svg", w: 25, h: 28 }],
    },
    {
      label: "MDX",
      marks: [{ id: "mdx", name: "MDX", asset: "mdx.svg", w: 58, h: 24, slot: 58 }],
    },
    {
      label: "Rust",
      marks: [{ id: "rust", name: "Rust", asset: "rust.svg", w: 26, h: 26 }],
    },
  ],
];

/** Scene frames at which each mark arrives, keyed by mark id. */
export interface WiringCues {
  marks: Readonly<Record<string, number>>;
  bars: number;
}

export function Wiring({ cues }: { cues: WiringCues }) {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        background: C.paper,
        padding: "0 160px",
        justifyContent: "center",
        opacity: sceneFade(frame, BAR * cues.bars, 18),
      }}
    >
      <Display size={72}>
        <Revealed text="Built into your stack." frame={frame} at={3} />
      </Display>

      <div style={{ display: "grid", rowGap: 60, marginTop: 80 }}>
        {ROWS.map((row) => (
          <div key={row[0].label} style={{ display: "flex", alignItems: "flex-start" }}>
            {row.map((group, index) => (
              <div
                key={group.label}
                style={
                  index
                    ? {
                        paddingLeft: 52,
                        marginLeft: 52,
                        // Each divider fades in with its group, so it never stands alone.
                        borderLeft: `1.5px solid rgba(221, 214, 198, ${ease(frame, firstCue(group, cues))})`,
                      }
                    : undefined
                }
              >
                <Group group={group} frame={frame} cues={cues} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function firstCue(group: IntegrationGroup, cues: WiringCues): number {
  return Math.min(...group.marks.map((mark) => cues.marks[mark.id] ?? 8));
}

function Group({
  group,
  frame,
  cues,
}: {
  group: IntegrationGroup;
  frame: number;
  cues: WiringCues;
}) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 22,
          fontWeight: 600,
          color: C.slate,
          ...arrive(frame, firstCue(group, cues) - 4),
        }}
      >
        {group.label}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 18 }}>
        {group.marks.map((mark) => (
          <div
            key={mark.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              ...arrive(frame, cues.marks[mark.id] ?? 8, 10),
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "flex-end",
                width: (mark.slot ?? 32) * SCALE,
                height: 32 * SCALE,
              }}
            >
              <Img
                src={staticFile(`logos/${mark.asset}`)}
                style={{ width: mark.w * SCALE, height: mark.h * SCALE, objectFit: "contain" }}
              />
            </span>
            <span
              style={{
                fontFamily: FONT.sans,
                fontSize: 30,
                fontWeight: 700,
                color: C.ink,
                whiteSpace: "nowrap",
              }}
            >
              {mark.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
