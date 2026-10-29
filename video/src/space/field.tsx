import { C } from "../brand";
import { At, type Vec } from "./camera";

/*
 * The space itself: a volume of small marks the camera flies through, so
 * every move shows depth even when the subject holds still. Points are
 * seeded, so every render places them identically.
 */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2_246_822_519) + 0x9e_37_79_b9) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4_294_967_296;
  };
}

interface Mote {
  id: string;
  p: Vec;
  size: number;
  tone: string;
  square: boolean;
}

export function motes(count: number, box: { min: Vec; max: Vec }, seed = 7): Mote[] {
  const r = rand(seed);
  return Array.from({ length: count }, (_, index) => {
    const roll = r();
    return {
      id: `${seed}-${index}`,
      p: [
        box.min[0] + r() * (box.max[0] - box.min[0]),
        box.min[1] + r() * (box.max[1] - box.min[1]),
        box.min[2] + r() * (box.max[2] - box.min[2]),
      ] as const,
      size: 5 + r() * 12,
      tone: roll < 0.18 ? C.bronze : roll < 0.6 ? C.ink : C.slate,
      square: roll > 0.45,
    };
  });
}

export function Dust({ points, opacity = 0.55 }: { points: readonly Mote[]; opacity?: number }) {
  return (
    <>
      {points.map((mote) => (
        <At key={mote.id} p={mote.p} opacity={opacity} cull={40} edge={false}>
          <div
            style={{
              width: mote.size,
              height: mote.size,
              borderRadius: mote.square ? 0 : 999,
              background: mote.tone,
            }}
          />
        </At>
      ))}
    </>
  );
}

/**
 * Large soft discs near the flight path: out-of-focus motes that pass close
 * to the lens and give every move a foreground.
 */
export function Bokeh({ points }: { points: readonly Mote[] }) {
  return (
    <>
      {points.map((mote) => {
        const size = mote.size * 9;
        const tint = mote.tone === C.bronze ? "188, 138, 69" : "79, 96, 116";
        return (
          <At key={mote.id} p={mote.p} cull={size} opacity={0.5} edge={false}>
            <div
              style={{
                width: size,
                height: size,
                borderRadius: 999,
                background: `radial-gradient(circle, rgba(${tint}, 0.22) 0%, rgba(${tint}, 0.12) 45%, rgba(${tint}, 0) 70%)`,
              }}
            />
          </At>
        );
      })}
    </>
  );
}
