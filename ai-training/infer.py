"""Run a trained checkpoint over an audio file (offline, whole file at once) and write a 16 kHz mono WAV.
Then compare with the original using bench_clips.py (the enhanced file is resampled to 48 kHz for comparison).

  python infer.py --ckpt runs/gtcrn_ft1/best.pt --arch gtcrn --gtcrn-dir ../gtcrn --inp clip.mp3 --out clip-ft1.wav
Note: the output is limited to 8 kHz (the model rate); the web app adds the >8 kHz band back separately.
"""
import argparse

import numpy as np
import torch

from audio_io import write_wav16
from metrics import load_stereo
from model import build_model, istft, load_state, stft


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True); ap.add_argument("--arch", default="gtcrn")
    ap.add_argument("--gtcrn-dir"); ap.add_argument("--hidden", type=int, default=256)
    ap.add_argument("--inp", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    x = load_stereo(a.inp, 16000).mean(1).astype(np.float32)
    model, hop = build_model(a.arch, a.gtcrn_dir, None, a.hidden)
    model.load_state_dict(load_state(a.ckpt))
    model.eval()
    with torch.no_grad():
        t = torch.from_numpy(x)[None]
        y = istft(model(stft(t, hop)), hop, t.shape[-1])[0].numpy()
    peak = float(np.max(np.abs(y)) + 1e-9)
    if peak > 0.99:
        y = y * (0.99 / peak)
    write_wav16(a.out, y)
    print(f"wrote {a.out} ({len(y) / 16000:.1f} s)")


if __name__ == "__main__":
    main()
