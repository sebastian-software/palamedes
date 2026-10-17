"""Write a synthetic stereo hall impulse response (decaying filtered noise)."""
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter

SR = 48000
n = int(SR * 3.2)
t = np.arange(n) / SR
ir = np.random.default_rng(1).standard_normal((n, 2)) * np.exp(-t / 0.75)[:, None]
b, a = butter(2, 5200 / (SR / 2))
ir = lfilter(b, a, ir, axis=0)
ir[: int(0.018 * SR)] = 0  # pre-delay
ir /= np.abs(ir).max()
sf.write(sys.argv[1], ir.astype(np.float32), SR)
