import { Composition, Still } from "remotion";

import { PalamedesFilm } from "./film/PalamedesFilm";
import { FILM_DURATION } from "./film/timeline";
import { PalamedesLaunch } from "./launch/PalamedesLaunch";
import { LAUNCH_DURATION } from "./launch/timeline";
import { Poster } from "./Poster";
import { PalamedesSpace } from "./space/Space";
import { SPACE_DURATION } from "./space/timeline";
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
    <Composition
      id="PalamedesLaunch"
      component={PalamedesLaunch}
      durationInFrames={LAUNCH_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="PalamedesSpace"
      component={PalamedesSpace}
      durationInFrames={SPACE_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Still id="PalamedesPoster" component={Poster} width={1920} height={1080} />
  </>
);
