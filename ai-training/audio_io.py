"""Small audio I/O helpers. Uses soundfile when installed, falls back to scipy for plain WAV files."""
from math import gcd

import numpy as np
from scipy.signal import resample_poly

SR = 16000


def read_audio(path):
    """Return (mono float32 array, sample_rate)."""
    try:
        import soundfile as sf
        x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except ImportError:
        from scipy.io import wavfile
        sr, x = wavfile.read(str(path))
        if x.dtype.kind == "i":
            x = x.astype(np.float32) / np.iinfo(x.dtype).max
        x = x.astype(np.float32)
        x = x[:, None] if x.ndim == 1 else x
    return x.mean(axis=1).astype(np.float32), sr


def load_16k(path):
    x, sr = read_audio(path)
    return resample(x, sr, SR)


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x.astype(np.float32)
    g = gcd(int(sr_in), int(sr_out))
    return resample_poly(x, sr_out // g, sr_in // g).astype(np.float32)


def write_wav16(path, x, sr=SR):
    x = np.clip(np.asarray(x, dtype=np.float32), -1, 1)
    try:
        import soundfile as sf
        sf.write(str(path), x, sr, subtype="PCM_16")
    except ImportError:
        from scipy.io import wavfile
        wavfile.write(str(path), sr, (x * 32767).astype(np.int16))
