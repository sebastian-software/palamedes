import { Composition, Still } from "remotion";

import { FLIGHT_DURATION, JourneyFlight } from "./flight/JourneyFlight";
import { PalamedesPromo } from "./PalamedesPromo";
import { Poster } from "./Poster";
import { DURATION, FPS } from "./timeline";

export const VideoRoot = () => (
  <>
    <Composition
      id="PalamedesPromo"
      component={PalamedesPromo}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="JourneyFlight"
      component={JourneyFlight}
      durationInFrames={FLIGHT_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Still id="PalamedesPoster" component={Poster} width={1920} height={1080} />
  </>
);
