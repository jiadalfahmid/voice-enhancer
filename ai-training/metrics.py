"""Reference-free and paired metrics for judging an enhancer on real clips (numpy/scipy only).
These are the checks used to judge the stand-in model on real recordings, packaged so every future
model can be compared on the same clips. They do NOT replace DNSMOS/listening tests (see eval.py)."""
import shutil
import subprocess

import numpy as np
from scipy import signal as sg

BANDS = [(100, 300), (300, 1000), (1000, 3000), (3000, 5000), (5000, 7000), (7000, 8000), (8000, 12000), (12000, 20000)]


def load_stereo(path, sr=48000):
    """Decode any file to (n, 2) float64 at `sr`. Uses ffmpeg when available (mp3, mp4, ...), else plain WAV via scipy."""
    if shutil.which("ffmpeg"):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ar", str(sr), "-ac", "2", "-f", "f32le", "pipe:1"],
                             capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)
    from scipy.io import wavfile
    fs, x = wavfile.read(str(path))
    x = x.astype(np.float64) / (np.iinfo(x.dtype).max if x.dtype.kind == "i" else 1.0)
    x = np.stack([x, x], 1) if x.ndim == 1 else x[:, :2]
    if fs != sr:
        x = sg.resample_poly(x, sr, fs, axis=0)
    return x


def _kweight(x, fs):
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / fs); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416; a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    f1, Q2 = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * f1 / fs); a0 = 1 + K / Q2 + K * K
    return sg.lfilter([1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0], sg.lfilter(b1, a1, x))


def lufs(x, fs):
    """ITU-R BS.1770-4 integrated loudness of (n, ch) audio, gated."""
    x = x.reshape(len(x), -1)
    step = int(0.1 * fs)
    n = len(x) // step
    if n < 4:
        return float("-inf")
    k = [_kweight(x[:, c], fs) for c in range(x.shape[1])]
    e = np.array([sum(np.mean(c[i * step:(i + 1) * step] ** 2) for c in k) for i in range(n)])
    z = np.array([e[i:i + 4].mean() for i in range(n - 3)])
    zz = z[z > 10 ** ((-70 + 0.691) / 10)]
    if len(zz) == 0:
        return float("-inf")
    zg = zz[zz > zz.mean() * 0.1]
    return float(-0.691 + 10 * np.log10(zg.mean())) if len(zg) else float("-inf")


def frame_levels_db(x, fs, win_s):
    n = int(win_s * fs)
    m = len(x) // n
    return np.array([20 * np.log10(np.sqrt(np.mean(x[i * n:(i + 1) * n] ** 2)) + 1e-9) for i in range(m)])


def decay_ms(x, fs, cap_ms=3000):
    """Median time (ms) the 10 ms level takes to fall 30 dB after speech offsets (from p90-10 dB to p90-40 dB).
    Capped at cap_ms; also returns the share of offsets that never fell that far (steady noise / long tails)."""
    env = frame_levels_db(x, fs, 0.01)
    hi = np.percentile(env, 90)
    t = []
    for i in range(2, len(env) - 2):
        if env[i - 1] > hi - 10 and env[i] <= hi - 10:
            j = i
            while j < len(env) - 1 and env[j] > hi - 40 and (j - i) * 10 < cap_ms:
                j += 1
            t.append(min(cap_ms, (j - i) * 10))
    if not t:
        return float("nan"), float("nan")
    t = np.array(t)
    return float(np.median(t)), float(np.mean(t >= cap_ms))


def ltas_db(x, fs):
    f, P = sg.welch(x, fs, nperseg=4096)
    ref = P[(f >= 100) & (f < 8000)].sum()
    return {f"{a}-{b}": float(10 * np.log10(P[(f >= a) & (f < b)].sum() / ref + 1e-20)) for a, b in BANDS}


def analyze(x, fs):
    """Metrics of one clip. x: (n, ch)."""
    x = x.reshape(len(x), -1)
    mid = x.mean(1)
    lev = frame_levels_db(mid, fs, 0.05)
    dm, never = decay_ms(mid, fs)
    out = {
        "lufs": lufs(x, fs),
        "peak_dbfs": float(20 * np.log10(np.abs(x).max() + 1e-12)),
        "level_p10_db": float(np.percentile(lev, 10)),
        "level_p50_db": float(np.percentile(lev, 50)),
        "level_p90_db": float(np.percentile(lev, 90)),
        "speech_to_floor_db": float(np.percentile(lev, 90) - np.percentile(lev, 10)),
        "decay30_ms": dm, "decay30_never_share": never,
        "ltas": ltas_db(mid, fs),
    }
    if x.shape[1] >= 2:
        s, m = np.std(x[:, 0] - x[:, 1]), np.std(x[:, 0] + x[:, 1])
        out["side_to_mid_db"] = float(20 * np.log10(s / m)) if m > 0 and s > 0 else float("-inf")
    return out


def band_change_db(orig, enh, fs):
    """Per-band level change (dB) of enh vs orig over the loudest quarter of frames, minus the overall change,
    so a pure gain change reads as 0. Shows where the enhancer removes or adds spectrum."""
    o, e = orig.mean(1), enh.mean(1)
    n = min(len(o), len(e))
    f, _, Zo = sg.stft(o[:n], fs, nperseg=2048, noverlap=1536)
    _, _, Ze = sg.stft(e[:n], fs, nperseg=2048, noverlap=1536)
    Eo, Ee = np.abs(Zo) ** 2, np.abs(Ze) ** 2
    loud = Eo.sum(0) > np.percentile(Eo.sum(0), 75)
    total = 10 * np.log10(Ee[:, loud].sum() / Eo[:, loud].sum())
    res = {}
    for a, b in BANDS:
        sel = (f >= a) & (f < b)
        if b > fs / 2 or Eo[sel][:, loud].sum() <= 0:
            continue  # band does not exist at this sample rate / is empty
        res[f"{a}-{b}"] = float(10 * np.log10(Ee[sel][:, loud].sum() / Eo[sel][:, loud].sum()) - total)
    return res


def compare(orig, enh, fs):
    n = min(len(orig), len(enh))
    a, b = analyze(orig[:n], fs), analyze(enh[:n], fs)
    return {"orig": a, "enh": b, "band_change_db": band_change_db(orig[:n], enh[:n], fs),
            "speech_to_floor_gain_db": b["speech_to_floor_db"] - a["speech_to_floor_db"]}  # level-independent
