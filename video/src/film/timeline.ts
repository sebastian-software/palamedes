import type { FlightWarp } from "../flight/JourneyFlight";
import { BAR, FPS } from "../timeline";

/*
 * The long cut: 48 bars at 84 BPM, the same grid as the promo. Scene
 * boundaries sit on downbeats; audio/cues/film.json holds the same plan for
 * the score and places Brian's takes on it, so change bars in both together.
 */
const SECTIONS = [
  ["open", 2],
  ["hook", 6],
  ["reveal", 5],
  ["journey", 14],
  ["complete", 6],
  ["frameworks", 4],
  ["fast", 3],
  ["agent", 3],
  ["claim", 2],
  ["end", 3],
] as const;

export type FilmSection = (typeof SECTIONS)[number][0];

export const FILM_SCENES = Object.fromEntries(
  SECTIONS.reduce<[FilmSection, { from: number; to: number; bars: number }][]>(
    (list, [name, bars]) => {
      const from = list.at(-1)?.[1].to ?? 0;
      list.push([name, { from, to: from + Math.round(bars * BAR), bars }]);
      return list;
    },
    [],
  ),
) as Record<FilmSection, { from: number; to: number; bars: number }>;

export const FILM_DURATION = FILM_SCENES.end.to;

/** Seconds into a section, as frames. */
export const at = (seconds: number) => Math.round(seconds * FPS);

/*
 * The journey choreography (12 bars) stretched onto 14 bars so each station
 * meets its line: write, extract at 9.6 s, translate at 16.2 s, build at
 * 20.5 s, split and load at 29 s.
 */
export const JOURNEY_WARP: FlightWarp = [
  [0, 0],
  [2, 3.2],
  [2.625, 3.6],
  [4.05, 5.5],
  [6, 7],
  [8.25, 10],
  [9.25, 10.6],
  [10, 11.1],
  [12, 14],
];
