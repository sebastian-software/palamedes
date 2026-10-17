"""The Palamedes promo score: an original, calm piano piece with a string pad.

Writes piano.mid, strings.mid and bars.json (bar start times in seconds) into
the directory given as the first argument. The bar plan matches SCENES in
src/timeline.ts (84 BPM, 23 bars), so every cut lands on a downbeat.

The arc: a sparse D minor problem, a turn to F major at the reveal, a steady
walk through the journey with a melody and strings, sixteenths for the speed
scene, one full chord on "Pick three.", and an arpeggio that rings out.
"""
import json, os, random, sys
import mido

OUT = sys.argv[1]
BPM = float(os.environ.get("BPM", 84))
TPB = 480
BAR = TPB * 4
rng = random.Random(5)

# Chord name -> (bass root midi, intervals of the chord from the root)
CH = {
    "Dm": (38, [0, 3, 7]), "Bb": (46, [0, 4, 7]), "F": (41, [0, 4, 7]), "C": (48, [0, 4, 7]),
    "Gm": (43, [0, 3, 7]), "A": (45, [0, 4, 7]), "Asus": (45, [0, 5, 7]),
}

# One entry per bar: (chord, or [chord, chord] for half bars; section).
PLAN = (
    [("Dm", "hook"), ("Bb", "hook"), ("Gm", "hook"), (["Asus", "A"], "hook")]
    + [("F", "meet"), ("C", "meet")]
    + [("Dm", "speak"), ("Bb", "speak")]
    + [("F", "journey"), ("C", "journey"), ("Dm", "journey"), ("Bb", "journey"), ("F", "journey"), ("C", "journey")]
    + [("Bb", "wiring"), ("C", "wiring")]
    + [("Dm", "rust"), ("Bb", "rust"), ("C", "rust")]
    + [(["Bb", "C"], "claim"), ("F", "claim")]
    + [("F", "end"), ("F", "end")]
)

# Short motifs per chord, two variations each (midi, start beat, beats).
MOTIF = {
    "Dm": [[(74, 0, 2), (77, 2, 1), (76, 3, 1)], [(74, 0, 3), (69, 3, 1)]],
    "Bb": [[(74, 0, 2), (70, 2, 2)], [(77, 0, 2), (74, 2, 1), (72, 3, 1)]],
    "F": [[(72, 0, 2), (77, 2, 2)], [(81, 0, 2), (77, 2, 1), (76, 3, 1)]],
    "C": [[(72, 0, 3), (76, 3, 1)], [(79, 0, 2), (76, 2, 2)]],
}

piano, strings = [], []  # (tick, msg)


def note(track, ch, pitch, start, length, vel, jitter=8):
    j = rng.randint(-jitter, jitter) if jitter else 0
    s = max(0, start + j)
    v = max(1, min(127, vel + rng.randint(-5, 5)))
    track.append((s, mido.Message("note_on", channel=ch, note=pitch, velocity=v)))
    track.append((s + length, mido.Message("note_off", channel=ch, note=pitch, velocity=0)))


def pedal(track, start, end):
    track.append((start + 20, mido.Message("control_change", channel=0, control=64, value=110)))
    track.append((end - 15, mido.Message("control_change", channel=0, control=64, value=0)))


SECTION_VEL = {"hook": 56, "meet": 62, "speak": 64, "journey": 66, "wiring": 68, "rust": 72, "claim": 82, "end": 70}
STRINGS_FROM = {"journey": 2}  # the pad enters on the third journey bar
bar_times = []
sec_per_tick = 60.0 / BPM / TPB

for b, (chords, sec) in enumerate(PLAN):
    t0 = b * BAR
    bar_times.append({"bar": b + 1, "t": round(t0 * sec_per_tick, 4), "section": sec})
    halves = chords if isinstance(chords, list) else [chords]
    base = SECTION_VEL[sec]
    if sec in ("rust", "claim"):
        base += 3 * sum(1 for x in PLAN[:b] if x[1] == sec)
    span = BAR // len(halves)
    for h, name in enumerate(halves):
        root, iv = CH[name]
        ts = t0 + h * span
        pedal(piano, ts, ts + span)
        eighths = span // (TPB // 2)
        if sec == "end" and b == len(PLAN) - 1:
            for k, p in enumerate([root + 12, root + 19, root + 24, root + 28, root + 31, root + 36]):
                note(piano, 0, p, ts + k * TPB // 2, BAR * 2, 40 - k * 2, jitter=4)
            continue
        if sec == "claim" and not isinstance(chords, list):
            # the full chord on "Pick three."
            for p in [root - 12, root, root + 7, root + 12, root + 16, root + 19, root + 24, root + 28]:
                note(piano, 0, p, ts, span, base, jitter=3)
            continue
        if sec == "end":
            for p in [root, root + 7, root + 12, root + 16, root + 24]:
                note(piano, 0, p, ts, span, base - 8, jitter=3)
            continue
        third = iv[1]
        lh = [0, 7, 12, third + 12, 19, third + 12, 12, 7]
        for k in range(eighths):
            vel = base - 6 + (8 if k == 0 else 0)
            note(piano, 0, root + lh[k % 8], ts + k * TPB // 2, TPB // 2 + 60, vel)
        if sec == "hook":
            # a single, questioning upper note in the first and third bar
            if h == 0 and b in (0, 2):
                note(piano, 0, 74 if b == 0 else 70, ts, BAR, base + 4)
            continue
        top = [root + 24 + i for i in iv] + [root + 36]
        while min(top) < 60:
            top = [p + 12 for p in top]
        sixteenths = sec in ("rust", "claim")
        step = TPB // 4 if sixteenths else TPB // 2
        pat = [0, 1, 2, 1]
        n = span // step
        for k in range(n):
            p = sorted(top)[pat[k % len(pat)] % len(top)]
            note(piano, 0, p, ts + k * step, step + 30, base - (14 if sixteenths else 10), jitter=6)
    # melody through the journey and the wiring, octave-doubled for speed
    if sec in ("speak", "journey", "wiring", "rust") and not isinstance(chords, list):
        seen = sum(1 for x in PLAN[:b] if x[0] == chords and x[1] in ("speak", "journey", "wiring", "rust"))
        for p, st, ln in MOTIF.get(chords, MOTIF["F"])[seen % 2]:
            v = base + 12
            note(piano, 0, p, t0 + st * TPB, ln * TPB - 40, v, jitter=5)
            if sec == "rust":
                note(piano, 0, p + 12, t0 + st * TPB, ln * TPB - 40, v - 10, jitter=5)
    # strings: a slow pad from the third journey bar on, cello on the root
    journey_index = sum(1 for x in PLAN[:b] if x[1] == "journey")
    if (sec == "journey" and journey_index >= STRINGS_FROM["journey"]) or sec in ("wiring", "rust", "claim", "end"):
        sv = {"journey": 58, "wiring": 66, "rust": 78, "claim": 92, "end": 80}[sec]
        length = BAR * (2 if b == len(PLAN) - 1 else 1)
        first = sec == "journey" and journey_index == STRINGS_FROM["journey"]
        last = b == len(PLAN) - 1
        for k in range(17):
            f = k / 16
            if first:
                e = 20 + 90 * f
            elif last:
                e = 110 * (1 - f) + 5
            else:
                e = 95 + 20 * (1 - abs(2 * f - 1))
            for ch in (0, 1):
                strings.append((t0 + int(f * (length - 1)), mido.Message("control_change", channel=ch, control=11, value=int(min(127, e)))))
        hl = length // len(halves)
        for h, name in enumerate(halves):
            root, iv = CH[name]
            for p in [root + 12 + i for i in iv] + [root + 24 + iv[1]]:
                note(strings, 0, p, t0 + h * hl, hl, sv, jitter=0)
            note(strings, 1, root, t0 + h * hl, hl, sv - 6, jitter=0)


def write(events, path, programs):
    mid = mido.MidiFile(ticks_per_beat=TPB)
    tr = mido.MidiTrack()
    mid.tracks.append(tr)
    tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0))
    for ch, prog in programs.items():
        tr.append(mido.Message("program_change", channel=ch, program=prog, time=0))
        tr.append(mido.Message("control_change", channel=ch, control=91, value=0, time=0))
        tr.append(mido.Message("control_change", channel=ch, control=93, value=0, time=0))
    last = 0
    for t, m in sorted(events, key=lambda e: (e[0], e[1].type == "note_on")):
        tr.append(m.copy(time=t - last))
        last = t
    mid.save(path)


write(piano, os.path.join(OUT, "piano.mid"), {0: 0})
write(strings, os.path.join(OUT, "strings.mid"), {0: 49, 1: 42})
json.dump({"bpm": BPM, "bar_seconds": 240 / BPM, "bars": bar_times}, open(os.path.join(OUT, "bars.json"), "w"), indent=1)
print(f"{len(PLAN)} bars, {len(PLAN) * 240 / BPM:.1f}s")
