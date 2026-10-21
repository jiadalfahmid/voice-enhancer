"""Run this FIRST. It builds a tiny synthetic corpus, runs a few training steps and one validation pass on the CPU,
and fails loudly if anything in the stack (augmentation, dataset, model, losses, checkpointing) is broken.

  python smoke_test.py                       # GRU model
  python smoke_test.py --gtcrn-dir ../gtcrn  # also GTCRN (with its pretrained checkpoint if present)
"""
import argparse
import pathlib
import tempfile

import numpy as np
from scipy.io import wavfile

SR = 16000


def speechlike(sec, seed):
    t = np.arange(int(sec * SR)) / SR
    f0 = 110 + 40 * np.sin(2 * np.pi * (0.4 + 0.1 * seed) * t)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    x = sum(np.sin(h * ph) / h * np.exp(-(((h * f0 - 800) / 1200) ** 2)) for h in range(1, 25))
    return (0.3 * x * np.clip(np.sin(2 * np.pi * 2.5 * t + seed), 0, None) ** 0.7).astype(np.float32)


def put(path, x):
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(path), SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    return str(path.resolve())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gtcrn-dir")
    a = ap.parse_args()
    import train  # imported late so a missing torch gives a clear error here

    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        rng = np.random.default_rng(0)
        lists = {"speech_train": [], "speech_val": [], "noise_train": [], "noise_val": [], "rir_train": [], "rir_val": []}
        for split, spks in (("train", range(3)), ("val", range(10, 12))):
            for s in spks:
                for k in range(2):
                    lists[f"speech_{split}"].append(put(d / "sp" / split / f"{s:03d}" / f"{k}.wav", speechlike(8, s * 7 + k)))
        for split in ("train", "val"):
            for k in range(3):
                lists[f"noise_{split}"].append(put(d / "nz" / f"{split}{k}.wav", 0.1 * rng.standard_normal(SR * 6)))
                h = np.zeros(int(0.5 * SR)); h[0] = 1
                h[40:] = 0.3 * rng.standard_normal(len(h) - 40) * 10 ** (-3 * (np.arange(40, len(h)) / SR) / 0.5)
                lists[f"rir_{split}"].append(put(d / "rir" / f"{split}{k}.wav", h))
        ld = d / "lists"; ld.mkdir()
        for k, v in lists.items():
            (ld / f"{k}.txt").write_text("\n".join(v) + "\n")

        runs = [["--arch", "gru", "--hidden", "64", "--lr", "1e-3"]]
        if a.gtcrn_dir:
            ck = pathlib.Path(a.gtcrn_dir) / "checkpoints" / "model_trained_on_dns3.tar"
            runs.append(["--arch", "gtcrn", "--gtcrn-dir", a.gtcrn_dir] + (["--init", str(ck)] if ck.exists() else []))
        for extra in runs:
            out = d / ("run_" + extra[1])
            train.main(["--lists", str(ld), "--epochs", "1", "--steps-per-epoch", "4", "--batch", "2", "--workers", "0",
                        "--val-examples", "4", "--device", "cpu", "--out", str(out), "--warmup", "2"] + extra)
            assert (out / "best.pt").exists(), "no checkpoint written"
            import infer
            wav = d / "probe.wav"; put(wav, speechlike(3, 1))
            infer.main(["--ckpt", str(out / "best.pt"), "--arch", extra[1], "--hidden", "64", "--inp", str(wav), "--out", str(d / "probe-out.wav")]
                       + (["--gtcrn-dir", a.gtcrn_dir] if extra[1] == "gtcrn" else []))
            assert (d / "probe-out.wav").exists(), "inference wrote nothing"
            print(f"smoke test OK for {extra[1]}")
    print("ALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    main()
