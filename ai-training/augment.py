"""Synthetic mixing for speech-enhancement training (PRD section 9), all at 16 kHz mono.

make_example() returns (noisy, target): both float32, equal length, time-aligned.

Target modes (the PRD's open decision, switchable):
  "reverb": target keeps the room            (safest, no de-reverberation)
  "early":  direct path + first 50 ms of the room (removes the echo tail, keeps a natural close-room feel)
  "dry":    fully dry speech                  (strongest de-reverb, riskiest)

Two presets: "prd" (the PRD's probabilities) and "farfield" (more reverb, interfering talkers and band-limited
inputs, for recordings like a camera mic across a room, which is the main complaint with the stand-in model).
"""
import shutil
import subprocess
from dataclasses import dataclass, replace

import numpy as np
from scipy.signal import butter, fftconvolve, sosfiltfilt

from audio_io import SR

EPS = 1e-9


@dataclass(frozen=True)
class AugConfig:
    snr_db: tuple = (-5.0, 25.0)
    p_reverb: float = 0.20
    p_interferer: float = 0.0       # other talker mixed into the input only
    sir_db: tuple = (0.0, 20.0)     # target speech vs interfering talker (level cue: target is louder)
    p_clip: float = 0.10
    p_codec: float = 0.15
    p_eq: float = 0.50
    tilt_db: float = 6.0
    p_bandlimit: float = 0.20
    bandlimit_hz: tuple = (3500.0, 8000.0)
    gain_dbfs: tuple = (-35.0, -5.0)
    p_pure: float = 0.05            # half pure noise (target silence), half pure speech (identity)
    target_mode: str = "reverb"
    early_ms: float = 50.0
    crop_seconds: float = 4.0


PRESETS = {
    "prd": AugConfig(),
    "farfield": AugConfig(p_reverb=0.55, p_interferer=0.25, p_bandlimit=0.40, p_codec=0.25, target_mode="early"),
}


def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + EPS))


def db(x):
    return 20 * np.log10(x + EPS)


def crop(x, n, rng):
    """Random crop of length n; short signals are tiled."""
    if len(x) < n:
        x = np.tile(x, int(np.ceil(n / max(1, len(x)))))
    start = int(rng.integers(0, len(x) - n + 1))
    return x[start:start + n].astype(np.float32)


def mix_at_snr(clean, noise, snr_db):
    """Scale `noise` so that rms(clean)/rms(noise) = snr_db, return clean + scaled noise and the scaled noise."""
    n = noise * (rms(clean) / (rms(noise) * 10 ** (snr_db / 20)))
    return clean + n, n


def apply_rir(x, rir, mode, early_ms=50.0, sr=SR):
    """Convolve with a RIR, aligned to its direct path. Returns (reverberant, target)."""
    rir = np.asarray(rir, dtype=np.float64)
    d = int(np.argmax(np.abs(rir)))
    rir = rir[d:] / (np.abs(rir[d]) + EPS)  # start at the direct path, unit direct gain
    wet = fftconvolve(x, rir)[: len(x)]
    if mode == "reverb":
        return wet.astype(np.float32), wet.astype(np.float32)
    if mode == "dry":
        return wet.astype(np.float32), x.astype(np.float32)
    if mode == "early":
        n = max(8, int(early_ms / 1000 * sr))
        e = rir[:n].copy()
        fade = min(n // 4, int(0.005 * sr))
        if fade > 0:
            e[-fade:] *= np.linspace(1, 0, fade)
        early = fftconvolve(x, e)[: len(x)]
        return wet.astype(np.float32), early.astype(np.float32)
    raise ValueError(f"unknown target mode {mode}")


def bandlimit(x, cutoff_hz, sr=SR):
    sos = butter(8, min(cutoff_hz, sr / 2 - 100) / (sr / 2), btype="low", output="sos")
    return sosfiltfilt(sos, x).astype(np.float32)


def tilt_eq(x, tilt_db, sr=SR):
    """Spectral tilt: gain goes linearly (in dB) with log-frequency, +tilt_db at 8 kHz and -tilt_db at ~60 Hz."""
    X = np.fft.rfft(x)
    f = np.maximum(np.fft.rfftfreq(len(x), 1 / sr), 60.0)
    pos = np.clip((np.log2(f) - np.log2(60.0)) / (np.log2(8000.0) - np.log2(60.0)), 0, 1)
    gain_db = (2 * pos - 1) * tilt_db
    return np.fft.irfft(X * 10 ** (gain_db / 20), len(x)).astype(np.float32)


def hard_clip(x, rng):
    """Drive the signal 1.5-4x into full scale and clip, then restore the original rms."""
    drive = float(rng.uniform(1.5, 4.0))
    peak = np.max(np.abs(x)) + EPS
    y = np.clip(x * drive / peak, -1.0, 1.0)
    return (y * (rms(x) / rms(y))).astype(np.float32)


def have_ffmpeg():
    return shutil.which("ffmpeg") is not None


def codec_roundtrip(x, codec, kbps, sr=SR, max_lag=4800):
    """Encode/decode through ffmpeg and re-align to the input (codecs add delay). Returns x unchanged without ffmpeg."""
    if not have_ffmpeg():
        return x
    fmt = {"mp3": ("libmp3lame", "mp3"), "opus": ("libopus", "ogg"), "aac": ("aac", "adts")}[codec]
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    enc = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
         "-c:a", fmt[0], "-b:a", f"{kbps}k", "-f", fmt[1], "pipe:1"], input=pcm, capture_output=True, check=True).stdout
    dec = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ar", str(sr), "-ac", "1", "pipe:1"],
        input=enc, capture_output=True, check=True).stdout
    y = np.frombuffer(dec, dtype="<i2").astype(np.float32) / 32767
    return align_to(x, y, max_lag)


def align_to(ref, y, max_lag):
    """Shift y so it lines up with ref (cross-correlation over +-max_lag), pad/trim to len(ref)."""
    n = min(len(ref), len(y), 3 * SR)
    seg_ref, seg_y = ref[:n], y[: n + max_lag]
    corr = fftconvolve(seg_y, seg_ref[::-1], mode="full")
    lag = int(np.argmax(corr[n - 1: n - 1 + max_lag + 1]))  # y delayed by `lag` samples
    y = y[lag:]
    out = np.zeros(len(ref), dtype=np.float32)
    m = min(len(ref), len(y))
    out[:m] = y[:m]
    return out


def _gain_to(x, target_dbfs):
    return 10 ** (target_dbfs / 20) / (rms(x) * 1.0)


def make_example(speech, noise, rirs, rng, cfg=AugConfig(), interferer=None, interferer_rirs=None):
    """
    speech: 1-D float array (16 kHz), noise: 1-D float array, rirs: list of 1-D arrays,
    interferer: another talker's audio (a different speaker), optional.
    Returns (noisy, target).
    """
    n = int(cfg.crop_seconds * SR)
    s = crop(speech, n, rng)
    s = s / (rms(s) + EPS) * 0.1  # working level -20 dBFS rms
    r = float(rng.random())

    if r < cfg.p_pure / 2:  # pure noise: the model must output silence
        nz = crop(noise, n, rng)
        nz = nz / (rms(nz) + EPS) * 0.1
        noisy, target = nz, np.zeros(n, dtype=np.float32)
    elif r < cfg.p_pure:    # pure speech: the model must not damage clean input
        noisy, target = s.copy(), s.copy()
    else:
        wet, target = s.copy(), s.copy()
        if rirs and rng.random() < cfg.p_reverb:
            wet, target = apply_rir(s, rirs[int(rng.integers(len(rirs)))], cfg.target_mode, cfg.early_ms)
        noisy = wet
        if interferer is not None and rng.random() < cfg.p_interferer:
            other = crop(interferer, n, rng)
            if interferer_rirs and rng.random() < 0.7:  # interfering talker is usually farther away / in a room
                other, _ = apply_rir(other, interferer_rirs[int(rng.integers(len(interferer_rirs)))], "reverb")
            sir = float(rng.uniform(*cfg.sir_db))
            noisy, _ = mix_at_snr(noisy, other, sir)  # added to the input only, never to the target
        nz = crop(noise, n, rng)
        noisy, _ = mix_at_snr(noisy, nz, float(rng.uniform(*cfg.snr_db)))
        if rng.random() < cfg.p_eq:
            noisy = tilt_eq(noisy, float(rng.uniform(-cfg.tilt_db, cfg.tilt_db)))
        if rng.random() < cfg.p_bandlimit:
            noisy = bandlimit(noisy, float(rng.uniform(*cfg.bandlimit_hz)))
        if rng.random() < cfg.p_clip:
            noisy = hard_clip(noisy, rng)
        if rng.random() < cfg.p_codec:
            codec = ["mp3", "opus", "aac"][int(rng.integers(3))]
            noisy = codec_roundtrip(noisy, codec, int(rng.choice([24, 32, 48, 64])))

    # level: random overall gain applied to input and target together, never clipping
    g = 10 ** (float(rng.uniform(*cfg.gain_dbfs)) / 20) / (rms(noisy) + EPS)
    noisy, target = noisy * g, target * g
    peak = max(np.max(np.abs(noisy)), np.max(np.abs(target)), EPS)
    if peak > 0.99:
        noisy, target = noisy * (0.99 / peak), target * (0.99 / peak)
    return noisy.astype(np.float32), target.astype(np.float32)


def with_preset(name, **overrides):
    return replace(PRESETS[name], **overrides)
