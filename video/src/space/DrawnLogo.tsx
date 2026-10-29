import { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

/*
 * The Palamedes mark, drawn rather than shown: the ring runs round first, the
 * outlines of the head trace themselves stroke by stroke, the fills follow,
 * then the laurel grows leaf by leaf along its stem. The drawing reads the
 * site's own logo.svg at render time, so the mark has one source.
 */
const NAVY = "#0E2A4D";
const GOLD = "#BC8A45";

let cached: Document | null = null;

function useLogoDocument(): Document | null {
  const [doc, setDoc] = useState<Document | null>(cached);
  const handle = useMemo(() => (cached ? null : delayRender("logo.svg")), []);
  useEffect(() => {
    if (cached || handle === null) return;
    void fetch(staticFile("logo.svg"))
      .then((response) => response.text())
      .then((text) => {
        cached = new DOMParser().parseFromString(text, "image/svg+xml");
        setDoc(cached);
        continueRender(handle);
      });
  }, [handle]);
  return doc;
}

const ramp = (t: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (t - from) / (to - from)));

/** Draw the mark; `t` runs 0 → 1 over the whole drawing. */
export function DrawnLogo({ t, size }: { t: number; size: number }) {
  const doc = useLogoDocument();
  const markup = useMemo(() => {
    if (!doc) return "";
    const svg = doc.documentElement.cloneNode(true) as Element;
    const ring = svg.querySelector("circle.ring");
    ring?.setAttribute("pathLength", "1");
    ring?.setAttribute("style", `stroke-dasharray:1;stroke-dashoffset:${1 - ramp(t, 0, 0.3)}`);
    const head = [...svg.querySelectorAll(".navy path")];
    head.forEach((path, index) => {
      const start = 0.08 + (index / Math.max(1, head.length)) * 0.3;
      const line = ramp(t, start, start + 0.2);
      const fill = ramp(t, start + 0.16, start + 0.34);
      path.setAttribute("pathLength", "1");
      path.setAttribute(
        "style",
        `stroke:${NAVY};stroke-width:1.4;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:${1 - line};fill-opacity:${fill}`,
      );
    });
    for (const group of svg.querySelectorAll('g[fill="#FFFFFF"]')) {
      group.setAttribute("opacity", String(ramp(t, 0.62, 0.78)));
    }
    const stem = svg.querySelector("path.stem");
    stem?.setAttribute("pathLength", "1");
    stem?.setAttribute("style", `stroke-dasharray:1;stroke-dashoffset:${1 - ramp(t, 0.5, 0.75)}`);
    const leaves = [...svg.querySelectorAll("path.gold")];
    leaves.forEach((leaf, index) => {
      const start = 0.55 + (index / Math.max(1, leaves.length)) * 0.3;
      const line = ramp(t, start, start + 0.1);
      const fill = ramp(t, start + 0.06, start + 0.15);
      leaf.setAttribute("pathLength", "1");
      leaf.setAttribute(
        "style",
        `stroke:${GOLD};stroke-width:1.2;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:${1 - line};fill-opacity:${fill}`,
      );
    });
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    return new XMLSerializer().serializeToString(svg);
  }, [doc, t, size]);
  return (
    <div
      style={{ width: size, height: size, lineHeight: 0 }}
      // The mark is the repository's own static SVG, re-serialized with drawing styles.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
