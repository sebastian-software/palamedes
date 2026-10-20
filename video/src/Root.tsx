import { Composition, Still } from "remotion";

import { PalamedesFilm } from "./film/PalamedesFilm";
import { FILM_DURATION } from "./film/timeline";
import { Poster } from "./Poster";
import { FPS } from "./timeline";

export const VideoRoot = () => (
  <>
    <Composition
      id="PalamedesFilm"
      component={PalamedesFilm}
      durationInFrames={FILM_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Still id="PalamedesPoster" component={Poster} width={1920} height={1080} />
  </>
);
