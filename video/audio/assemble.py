"""Place the chosen takes of a cue sheet on the timeline.

usage: assemble.py <work> <cues.json> <out-dir>
Writes <out-dir>/vo.wav (48 kHz mono) and <out-dir>/captions.srt.
"""
import json, os, sys
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

WORK, CUES, OUT = sys.argv[1:4]
VO = os.path.join(WORK, "takes")
SR = 48000
CUE = json.load(open(CUES))
TOTAL = CUE["total"]

track = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
captions = []
for c in CUE["cues"]:
    x, sr = sf.read(os.path.join(VO, c["take"] + ".wav"), dtype="float32")
    if x.ndim > 1:
        x = x.mean(axis=1)
    a, b = c.get("trim", [0, None])
    x = x[int(a * sr) : (int(b * sr) if b else None)]
    x = resample_poly(x, SR, sr).astype(np.float32)
    # level every take to the same speech loudness (RMS over the voiced part)
    voiced = x[np.abs(x) > 0.01]
    x *= 10 ** (-19 / 20) / max(1e-6, float(np.sqrt(np.mean(voiced**2))))
    # short fades so trims never click
    n = int(0.012 * SR)
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    i = int(c["at"] * SR)
    track[i : i + len(x)] += x * c.get("gain", 1.0)
    if c.get("text"):
        captions.append((c["at"] + c.get("on", 0.22), c["at"] + len(x) / SR - 0.15, c["text"]))

sf.write(os.path.join(OUT, "vo.wav"), track[: int(TOTAL * SR)], SR)

def ts(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02}:{int(m):02}:{int(s):02},{int(round((s % 1) * 1000)):03}"

with open(os.path.join(OUT, "captions.srt"), "w") as f:
    for k, (s, e, t) in enumerate(captions, 1):
        f.write(f"{k}\n{ts(s)} --> {ts(e)}\n{t}\n\n")
