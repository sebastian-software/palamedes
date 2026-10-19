import { describe, expect, it } from "vitest";
import { VideoCoverage } from "./video-analytics";

function fixture() {
  const events: [string, unknown][] = [];
  const coverage = new VideoCoverage((name, properties) => events.push([name, properties]));
  let clock = 0;
  function play(from: number, to: number, duration = 100, rate = 1) {
    coverage.receive("playbackratechange", rate);
    coverage.receive("play");
    for (let seconds = from; seconds <= to; seconds++) {
      coverage.receive("timeupdate", { seconds, duration }, (clock += 1000 / rate));
    }
  }
  return { events, coverage, play };
}

describe("video playback coverage", () => {
  it("reports one start, each milestone, and a completed playback", () => {
    const { coverage, events, play } = fixture();
    play(0, 100);
    coverage.receive("ended");
    expect(events).toEqual([
      ["video_start", undefined],
      ["video_progress", { percent: 25 }],
      ["video_progress", { percent: 50 }],
      ["video_progress", { percent: 75 }],
      ["video_complete", undefined],
    ]);
  });

  it("doesn't count a play request that never advances", () => {
    const { coverage, events } = fixture();
    coverage.receive("play");
    coverage.receive("timeupdate", { seconds: 0, duration: 100 }, 0);
    coverage.receive("timeupdate", { seconds: 0, duration: 100 }, 1000);
    coverage.receive("ended");
    expect(events).toEqual([]);
  });

  it("doesn't treat seeking to the end as completion", () => {
    const { coverage, events, play } = fixture();
    play(0, 2);
    coverage.receive("timeupdate", { seconds: 99, duration: 100 }, 4000);
    coverage.receive("seeked");
    coverage.receive("timeupdate", { seconds: 100, duration: 100 }, 5000);
    coverage.receive("ended");
    expect(events).toEqual([["video_start", undefined]]);
  });

  it("merges overlapping sections and ignores repeated play and end events", () => {
    const { coverage, events, play } = fixture();
    play(0, 50);
    coverage.receive("pause");
    play(0, 50);
    expect(events.filter(([name]) => name === "video_progress")).toHaveLength(2);
    play(50, 100);
    coverage.receive("ended");
    play(0, 100);
    coverage.receive("ended");
    expect(events.filter(([name]) => name === "video_start")).toHaveLength(1);
    expect(events.filter(([name]) => name === "video_progress")).toHaveLength(3);
    expect(events.filter(([name]) => name === "video_complete")).toHaveLength(1);
  });

  it("preserves coverage across dialog close/reopen without bridging the gap", () => {
    const { coverage, events, play } = fixture();
    play(0, 50);
    coverage.interrupt();
    play(90, 100);
    coverage.receive("ended");
    expect(events.filter(([name]) => name === "video_progress")).toHaveLength(2);
    expect(events.some(([name]) => name === "video_complete")).toBe(false);
  });

  it("accounts for faster playback and requires 90% unique coverage", () => {
    const { coverage, events, play } = fixture();
    play(10, 100, 100, 2);
    coverage.receive("ended");
    expect(events.at(-1)?.[0]).toBe("video_complete");
    const partial = fixture();
    partial.play(11, 100);
    partial.coverage.receive("ended");
    expect(partial.events.some(([name]) => name === "video_complete")).toBe(false);
  });

  it("ignores paused samples, malformed timing, and suspended sample gaps", () => {
    const { coverage, events } = fixture();
    coverage.receive("timeupdate", { seconds: 50, duration: 100 }, 0);
    coverage.receive("play");
    coverage.receive("timeupdate", { seconds: Number.NaN, duration: 100 }, 0);
    coverage.receive("timeupdate", { seconds: 0, duration: 0 }, 0);
    coverage.receive("timeupdate", { seconds: 0, duration: 100 }, 0);
    coverage.receive("timeupdate", { seconds: 50, duration: 100 }, 50_000);
    coverage.receive("pause");
    coverage.receive("timeupdate", { seconds: 100, duration: 100 }, 100_000);
    expect(events).toEqual([]);
  });

  it("can join autoplay after the ready event through getPaused", () => {
    const { coverage, events } = fixture();
    coverage.receive("getPaused", false);
    coverage.receive("timeupdate", { seconds: 0, duration: 100 }, 0);
    coverage.receive("timeupdate", { seconds: 1, duration: 100 }, 1000);
    expect(events).toEqual([["video_start", undefined]]);
  });
});
