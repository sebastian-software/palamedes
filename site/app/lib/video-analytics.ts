import type { TrackEvent } from "./analytics";

/** Union of played intervals, so revisiting a section never increases coverage. */
export class VideoCoverage {
  private intervals: [number, number][] = [];
  private previous: { seconds: number; at: number } | null = null;
  private playing = false;
  private started = false;
  private completed = false;
  private milestones = new Set<number>();
  private duration = 0;
  private rate = 1;

  public constructor(private readonly track: TrackEvent) {}

  public interrupt() {
    this.previous = null;
    this.playing = false;
  }

  public receive(event: string, value?: unknown, at = performance.now()) {
    if (event === "play" || event === "getPaused") {
      this.playing = event === "play" || value === false;
      this.previous = null;
    } else if (event === "pause" || event === "seeked") {
      this.previous = null;
      if (event === "pause") this.playing = false;
    } else if (event === "playbackratechange") {
      if (typeof value === "number" && value > 0 && value <= 16) this.rate = value;
      this.previous = null;
    } else if (event === "timeupdate" && this.playing) {
      if (!value || typeof value !== "object" || !("seconds" in value) || !("duration" in value))
        return;
      const { seconds, duration } = value;
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        seconds < 0 ||
        seconds > duration
      )
        return;
      this.duration = duration;
      const previous = this.previous;
      this.previous = { seconds, at };
      if (!previous) return;
      const delta = seconds - previous.seconds;
      // Ignore seeks and discontinuities, including a suspended/background timer.
      const elapsed = (at - previous.at) / 1000;
      if (delta <= 0 || elapsed <= 0 || elapsed > 2 || delta > elapsed * this.rate + 0.15) return;
      if (!this.started) {
        this.started = true;
        this.track("video_start");
      }
      this.intervals.push([previous.seconds, seconds]);
      this.intervals.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const interval of this.intervals) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
        else merged.push([...interval]);
      }
      this.intervals = merged;
      const percent = this.coverage() * 100;
      for (const threshold of [25, 50, 75]) {
        if (percent >= threshold && !this.milestones.has(threshold)) {
          this.milestones.add(threshold);
          this.track("video_progress", { percent: threshold });
        }
      }
    } else if (event === "ended") {
      if (this.started && !this.completed && this.coverage() >= 0.9) {
        this.completed = true;
        this.track("video_complete");
      }
      this.interrupt();
    }
  }

  private coverage() {
    return this.duration > 0
      ? this.intervals.reduce((sum, [start, end]) => sum + end - start, 0) / this.duration
      : 0;
  }
}

const EVENTS = ["play", "pause", "seeked", "timeupdate", "ended", "playbackratechange"];

/** Player.js protocol: https://github.com/embedly/player.js/blob/master/SPEC.rst */
export function observeBunnyPlayer(frame: HTMLIFrameElement, coverage: VideoCoverage): () => void {
  const origin = new URL(frame.src).origin;
  const listener = "palamedes-analytics";
  function send(method: string, value?: string) {
    frame.contentWindow?.postMessage(
      JSON.stringify({
        context: "player.js",
        version: "0.0.11",
        method,
        value,
        listener,
      }),
      origin,
    );
  }
  function subscribe() {
    for (const name of EVENTS) {
      send("removeEventListener", name);
      send("addEventListener", name);
    }
    // Autoplay may already be running by the time the iframe load event fires.
    send("getPaused");
  }
  function message(event: MessageEvent) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    let data;
    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!data || data.context !== "player.js") return;
    if (data.event === "ready") subscribe();
    else if (data.listener === listener) coverage.receive(data.event, data.value);
  }
  window.addEventListener("message", message);
  frame.addEventListener("load", subscribe);
  return () => {
    window.removeEventListener("message", message);
    frame.removeEventListener("load", subscribe);
    for (const name of EVENTS) send("removeEventListener", name);
    coverage.interrupt();
  };
}
