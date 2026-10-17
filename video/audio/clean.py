"""Trim takes to their real speech: drop short bursts that sit apart at the start or end.

A take can end with a fragment of the next line after a pause, or with a click.
Regions shorter than 0.35 s that sit more than 0.25 s apart from the speech
are dropped; the rest is cut 40 ms before the first and 180 ms after the last
sound, with a short fade out. Output is mono at the input rate.

usage: clean.py <in> <out.wav> [<in> <out.wav> ...]
"""
import json, sys
import numpy as np, soundfile as sf

HOP = 0.01
ON = -45.0  # dBFS frame level counted as sound


def regions(a, sr):
    n = int(HOP * sr)
    frames = len(a) // n
    db = np.array([20 * np.log10(np.sqrt(np.mean(a[i * n:(i + 1) * n] ** 2)) + 1e-9) for i in range(frames)])
    on = db > ON
    out, start = [], None
    for i, v in enumerate(on):
        if v and start is None: start = i
        if not v and start is not None:
            out.append([start * HOP, i * HOP]); start = None
    if start is not None: out.append([start * HOP, frames * HOP])
    # merge regions closer than 0.15 s (normal articulation gaps)
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] < 0.15: merged[-1][1] = r[1]
        else: merged.append(r)
    return merged


def clean(src, dst):
    a, sr = sf.read(src, dtype="float32")
    if a.ndim > 1: a = a.mean(axis=1)
    rs = regions(a, sr)
    dropped = []
    while len(rs) > 1 and rs[-1][1] - rs[-1][0] < 0.35 and rs[-1][0] - rs[-2][1] > 0.25:
        dropped.append(("end", *rs.pop()))
    while len(rs) > 1 and rs[0][1] - rs[0][0] < 0.35 and rs[1][0] - rs[0][1] > 0.25:
        dropped.append(("start", *rs.pop(0)))
    s = max(0.0, rs[0][0] - 0.04)
    e = min(len(a) / sr, rs[-1][1] + 0.18)
    out = a[int(s * sr):int(e * sr)].copy()
    fade = int(0.08 * sr)
    out[-fade:] *= np.linspace(1, 0, fade)
    sf.write(dst, out, sr)
    return dropped, round(e - s, 2)


if __name__ == "__main__":
    for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
        dropped, length = clean(src, dst)
        print(f"{src}: {length}s", "DROPPED " + str([(k, round(a, 2), round(b, 2)) for k, a, b in dropped]) if dropped else "")
