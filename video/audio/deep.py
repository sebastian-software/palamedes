"""The launch cut's score: an original melodic deep-house piece with grand piano.

usage: deep.py midi <cues.json> <piano.mid>
       deep.py render <cues.json> <piano.wav> <ir.wav> <out.wav>

The first form writes the piano part as MIDI, which build-launch.sh renders
with the Salamander grand. The second synthesizes drums, bass, pad and effects
in numpy, mixes the rendered piano in, and writes the music bed.

The cue sheet's "plan" names one section per bar at its "bpm" (one bar is
2 s at 120 BPM). Sections: intro (piano alone, the pad and a filtered kick
opening up), groove (four-on-the-floor, rolling bass, pumping pad, piano
arpeggio), break (sustained piano chords, riser, snare roll), drop (groove
plus the piano melody in octaves), end (one hit on the downbeat), tail (the
last chord rings out). The harmony loops Dm9, Bbmaj7, Fmaj7, Cadd9 per bar;
end and tail hold the end bar's chord. Genre traits only: no melody, riff or
progression is taken from an existing track.
"""
import json, sys
import numpy as np

MODE_MIDI = sys.argv[1] == "midi"
CUES = json.load(open(sys.argv[2]))
PLAN = CUES["plan"]
BPM = CUES.get("bpm", 120)
SR = 48000
BEAT = 60 / BPM
S16 = BEAT / 4
BAR = BEAT * 4
BARS = len(PLAN)
TOTAL = BARS * BAR + 2.0
N = int(TOTAL * SR)
rng = np.random.default_rng(12)

# (bass root, voicing) per chord: Dm9, Bbmaj7, Fmaj7, Cadd9
CHORDS = [
    (38, [50, 53, 57, 60, 64]),
    (34, [53, 57, 58, 62]),
    (41, [53, 57, 60, 64]),
    (36, [55, 60, 62, 64]),
]
END_BAR = PLAN.index("end") if "end" in PLAN else BARS - 1
# One melodic phrase per chord, so a drop may start on any chord of the loop:
# (16th, length in 16ths, midi)
MOTIF = {
    0: [(0, 6, 69), (6, 2, 67), (8, 8, 65)],
    1: [(0, 6, 65), (6, 2, 62), (8, 8, 70)],
    2: [(0, 4, 69), (4, 4, 72), (8, 8, 76)],
    3: [(0, 12, 74), (12, 4, 72)],
}


def at(bar, s16=0.0):
    return bar * BAR + s16 * S16


def section(bar):
    return PLAN[bar] if 0 <= bar < BARS else None


def chord(bar):
    return CHORDS[(min(bar, END_BAR)) % 4]


def run_start(bar):
    """First bar of the run of equal sections that contains `bar`."""
    while bar > 0 and section(bar - 1) == section(bar):
        bar -= 1
    return bar


def run_end(bar):
    while bar < BARS - 1 and section(bar + 1) == section(bar):
        bar += 1
    return bar


def arp(bar):
    top = sorted(chord(bar)[1])[-3:]
    return [top[2] + 12, top[0] + 12, top[1] + 12]


# --- piano part --------------------------------------------------------------
if MODE_MIDI:
    import mido

    TPB = 480
    events = []

    def note(sec, dur, m, v):
        events.append((int(sec / BEAT * TPB), 1, m, int(np.clip(v, 1, 127))))
        events.append((int((sec + dur) / BEAT * TPB), 0, m, 0))

    for bar, name in enumerate(PLAN):
        root, voicing = chord(bar)
        if name == "end":
            for m in [root + 12, *voicing, voicing[-1] + 12]:
                note(at(bar), BAR * 3.5, m + 12, 72)
            continue
        if name == "tail":
            if bar == END_BAR + 2:  # one quiet arpeggio as the chord rings out
                for k, m in enumerate(sorted(voicing)[1:] + [voicing[0] + 12]):
                    note(at(bar, k * 2), BAR, m + 24, 40 - k * 3)
            continue
        if name == "break":
            for i, m in enumerate(voicing):
                note(at(bar) + i * 0.012, BAR * 0.95, m + 12, 60)
            note(at(bar), BAR * 0.95, root + 12, 62)
            continue
        pattern = arp(bar)
        lift = {"intro": 0, "groove": 6, "drop": 2}[name]
        for k in range(16):
            step = bar * 16 + k
            v = (64 if step % 3 == 0 else 50) + lift + int(rng.integers(-4, 5))
            note(at(bar, k) + (0.006 if k % 2 else 0), S16 * 1.8, pattern[step % 3], v)
        if name == "intro":  # left hand, as in the earlier piano score
            note(at(bar), BAR * 0.95, root + 12, 62)
        if name == "drop":
            for s16, length, m in MOTIF[bar % 4]:
                note(at(bar, s16), length * S16, m + 12, 86)
                note(at(bar, s16), length * S16, m, 66)
    events.sort(key=lambda e: (e[0], e[1]))
    mid = mido.MidiFile(ticks_per_beat=TPB)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM)))
    last = 0
    for tick, on, m, v in events:
        kind = "note_on" if on else "note_off"
        track.append(mido.Message(kind, note=m, velocity=v, time=tick - last))
        last = tick
    mid.save(sys.argv[3])
    sys.exit(0)

import soundfile as sf
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x, axis=0)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x, axis=0)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x, axis=0)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def saw(f, n, phase=0.0):
    """PolyBLEP sawtooth."""
    dt = f / SR
    p = (phase + dt * np.arange(n)) % 1.0
    y = 2 * p - 1
    a = p < dt
    x = p[a] / dt
    y[a] -= x + x - x * x - 1
    b = p > 1 - dt
    x = (p[b] - 1) / dt
    y[b] -= x * x + x + x + 1
    return y


def adsr(n, a, d, s, r, hold):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > hold
    e[rel] *= np.exp(-(t[rel] - hold) / max(r, 1e-4))
    return e


def place(bus, start, sig, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[i : i + len(sig), 0] += sig * gain * left * 1.414
    bus[i : i + len(sig), 1] += sig * gain * right * 1.414


def new_bus():
    return np.zeros((N, 2))


BEATING = {"groove", "drop"}
t_all = np.arange(N) / SR

# --- drums -------------------------------------------------------------------
def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh(1.6 * (body + click))


def clap():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for k, d in enumerate((0.0, 0.011, 0.022)):
        m = t >= d
        env[m] += np.exp(-(t[m] - d) / (0.008 if k < 2 else 0.12))
    return bp(rng.standard_normal(n), 900, 5200) * env * 0.8


def hat(length):
    n = int(length * 6 * SR)
    return hp(rng.standard_normal(n), 7500, 4) * np.exp(-np.arange(n) / SR / length)


def crash():
    n = int(2.5 * SR)
    return hp(rng.standard_normal(n), 4000) * np.exp(-np.arange(n) / SR / 0.7) * 0.5


KICK = kick()
drums, muffled = new_bus(), new_bus()
kicks = []
for bar, name in enumerate(PLAN):
    first = run_start(bar) == bar
    if name in BEATING:
        for b in range(4):
            kicks.append(at(bar, b * 4))
            place(drums, at(bar, b * 4), KICK, 0.95)
        for b in (1, 3):
            place(drums, at(bar, b * 4) + 0.004, clap(), 0.55, 0.05)
        open_hats = name == "drop" or bar - run_start(bar) >= 2
        for k in range(16):
            swing = 0.018 if k % 2 else 0.0
            if k % 4 == 2 and open_hats:
                place(drums, at(bar, k) + swing, hat(0.11), 0.22, -0.2)
            elif k % 2:
                place(drums, at(bar, k) + swing, hat(0.025), 0.2 if k % 4 == 3 else 0.14, 0.3)
        if first:
            place(drums, at(bar), crash(), 0.7 if name == "drop" else 0.35)
    if name == "intro" and bar >= run_end(bar) - 1:
        for b in range(4):
            kicks.append(at(bar, b * 4))
            place(muffled, at(bar, b * 4), KICK, 0.9)
    shaker = name in BEATING or (name == "intro" and bar >= run_end(bar) - 1)
    if shaker:
        for k in range(16):
            place(drums, at(bar, k) + (0.014 if k % 2 else 0), hat(0.04), 0.06 + 0.03 * (k % 4 == 2), -0.4)
    if name == "break" and bar == run_end(bar):
        for k in range(16):
            place(drums, at(bar, k), clap(), 0.08 + 0.025 * k, 0.05)
    if name == "end":
        kicks.append(at(bar))
        place(drums, at(bar), KICK, 1.0)
        place(drums, at(bar), crash(), 0.6)
drums += lp(muffled, 220)

duck = np.ones(N)
for kt in kicks:
    i = int(kt * SR)
    seg = np.arange(min(int(0.4 * SR), N - i)) / SR
    duck[i : i + len(seg)] = np.minimum(duck[i : i + len(seg)], 1 - 0.65 * np.exp(-seg / 0.11))

# --- pad ---------------------------------------------------------------------
pad = new_bus()
for bar, name in enumerate(PLAN):
    if name == "tail":
        continue
    _, voicing = chord(bar)
    hold = BAR * (1 + sum(1 for s in PLAN[bar + 1 :] if s == "tail")) if name == "end" else BAR
    n = int((hold + 1.2) * SR)
    env = adsr(n, 0.35, 0.8, 0.85, 0.6 if name != "end" else 1.5, hold)
    for m in voicing:
        for v in range(7):
            f = hz(m) * 2 ** ((v - 3) * 6.5 / 1200)
            place(pad, at(bar), saw(f, n, rng.random()) * env, 0.022, (v - 3) / 3 * 0.8)
bright = lp(pad, 2400)
dark = lp(pad, 650)
# Brightness per bar: dark intro, half-open grooves, opening through a break, open drops.
knots_t, knots_b = [], []
for bar, name in enumerate(PLAN):
    if name == "break":
        a, b = run_start(bar), run_end(bar)
        lo = 0.35 + 0.65 * (bar - a) / (b - a + 1)
        hi = 0.35 + 0.65 * (bar - a + 1) / (b - a + 1)
    else:
        lo = hi = {"intro": 0.0, "groove": 0.35, "drop": 1.0, "end": 0.8, "tail": 0.8}[name]
    knots_t += [at(bar) + 0.05, at(bar + 1) - 0.05]
    knots_b += [lo, hi]
openness = np.interp(t_all, knots_t, knots_b)[:, None]
pad = (dark * (1 - openness) + bright * openness) * duck[:, None]

# --- bass --------------------------------------------------------------------
bass = new_bus()
for bar, name in enumerate(PLAN):
    root, _ = chord(bar)
    if name == "end":
        n = int(BAR * SR)
        f = hz(root)
        x = 0.6 * saw(f, n) + 0.8 * np.sin(2 * np.pi * f * np.arange(n) / SR)
        place(bass, at(bar), lp(x, 500) * adsr(n, 0.004, 0.4, 0.4, 0.5, 0.6), 0.5)
    if name not in BEATING:
        continue
    for b in range(4):
        for k, (dm, g) in enumerate(((0, 1.0), (12, 0.6), (0, 0.85))):
            n = int(0.115 * SR)
            f = hz(root + dm)
            sub = np.sin(2 * np.pi * (f / 2 if dm else f) * np.arange(n) / SR)
            x = 0.6 * saw(f, n) + 0.8 * sub
            snap = np.exp(-np.arange(n) / SR / 0.03)
            sig = (lp(x, 1800) * snap + lp(x, 380) * (1 - snap)) * adsr(n, 0.004, 0.06, 0.55, 0.02, 0.095)
            place(bass, at(bar, b * 4 + 1 + k), sig, 0.5 * g)
bass = lp(bass, 2500)

# --- riser into each drop ------------------------------------------------------
riser = new_bus()
for bar, name in enumerate(PLAN):
    if name != "break" or run_start(bar) != bar:
        continue
    n = int((run_end(bar) - bar + 1) * BAR * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    sweep = np.zeros(n)
    blocks = 64
    for i in range(blocks):
        a, b = i * n // blocks, (i + 1) * n // blocks
        f = 300 * (12000 / 300) ** (i / blocks)
        sweep[a:b] = bp(noise[a:b], f, min(f * 1.8, 20000))
    place(riser, at(bar), sweep * (t / t[-1]) ** 2, 0.25)

# --- piano, effects, mix -------------------------------------------------------
piano_wav, piano_sr = sf.read(sys.argv[3])
if piano_wav.ndim == 1:
    piano_wav = np.stack([piano_wav, piano_wav], axis=1)
if piano_sr != SR:
    piano_wav = resample_poly(piano_wav, SR, piano_sr, axis=0)
piano = np.zeros((N, 2))
piano[: min(N, len(piano_wav))] = piano_wav[:N]
piano = hp(piano, 110)
piano /= np.max(np.abs(piano)) / 0.5
piano *= (duck * 0.3 + 0.7)[:, None]

ir, ir_sr = sf.read(sys.argv[4])
if ir.ndim == 1:
    ir = np.stack([ir, ir], axis=1)
if ir_sr != SR:
    ir = resample_poly(ir, SR, ir_sr, axis=0)
ir = ir / np.max(np.abs(ir))


def reverb(x, wet):
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], axis=1)
    return y / (np.max(np.abs(y)) + 1e-9) * np.max(np.abs(x)) * wet


def pingpong(x, delay, fb, repeats=6):
    out = np.zeros_like(x)
    d = int(delay * SR)
    echo = x.mean(axis=1)
    for k in range(1, repeats + 1):
        echo = lp(echo, 4500)
        out[k * d :, k % 2] += echo[: N - k * d] * fb**k
    return out


piano_fx = piano + pingpong(piano, 3 * S16, 0.22) * 0.6
# the intro opens the pad like a filter sweep; the piano stays clear
intro_end = at(PLAN.index("groove")) if "groove" in PLAN else 0
sweep = np.clip(t_all / max(intro_end, 1e-3), 0, 1)[:, None] ** 1.5
pad = lp(pad, 500) * (1 - sweep) + pad * sweep
music = pad + piano_fx + reverb(pad * 0.5 + piano_fx, 0.35)
mix = hp(music + bass + drums + riser + reverb(drums * 0.3, 0.12), 28)
mix = np.tanh(mix * 1.2) / 1.2
mix /= np.max(np.abs(mix)) / 0.89
sf.write(sys.argv[5], mix.astype(np.float32), SR, subtype="FLOAT")
