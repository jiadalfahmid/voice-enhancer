"""Turn the raw downloads into 16 kHz mono 16-bit WAVs plus list files for training.

  python prepare_data.py --speech datasets/libritts_train_clean_100:train datasets/libritts_dev_clean:val \
                                  datasets/libritts_test_clean:test \
                         --noise datasets/rirs_noises --out prepared

Speech splits come from the folders you assign (LibriTTS dev/test have different speakers than train), and the
script refuses to finish if any speaker appears in two splits. Noises and RIRs are split 90/10 by a hash of the file
name so the split never changes between runs. Lists written to <out>/lists/.
"""
import argparse
import hashlib
import pathlib

import numpy as np

from audio_io import SR, load_16k, write_wav16


def speaker_of(path, split_root):
    rel = pathlib.Path(path).relative_to(split_root)
    parts = [p for p in rel.parts]
    # LibriTTS: <set>/<speaker>/<chapter>/file.wav ; unpack dirs may add one wrapper level, so use the first
    # directory whose name is purely numeric, else the first directory.
    for p in parts[:-1]:
        if p.isdigit():
            return p
    return parts[0] if len(parts) > 1 else "unknown"


def find_wavs(root):
    return sorted(pathlib.Path(root).rglob("*.wav"))


def to16k(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    write_wav16(dst, load_16k(src))


def bucket(name, fractions=(0.9,)):
    h = int(hashlib.sha1(name.encode()).hexdigest(), 16) % 1000 / 1000
    return "train" if h < fractions[0] else "val"


def prepare_speech(specs, out, max_files=None):
    """max_files: cap per directory, picked by a stable hash of the file name (quick first experiments)."""
    seen = {}
    lists = {"train": [], "val": [], "test": []}
    for spec in specs:
        root, split = spec.rsplit(":", 1)
        files = find_wavs(root)
        if max_files:
            files = sorted(files, key=lambda p: hashlib.sha1(p.name.encode()).hexdigest())[:max_files]
        for w in files:
            spk = speaker_of(w, root)
            if seen.setdefault(spk, split) != split:
                raise SystemExit(f"speaker {spk} appears in both {seen[spk]} and {split}: splits must be speaker-disjoint")
            dst = out / "speech" / split / spk / (w.stem + ".wav")
            to16k(w, dst)
            lists[split].append(dst)
    return lists


def prepare_noise_rir(root, out):
    root = pathlib.Path(root)
    noises, rirs = [], []
    for w in find_wavs(root):
        s = str(w).replace("\\", "/").lower()
        if "rir" in s and "noise" not in w.name.lower():
            rirs.append(w)
        elif "noise" in s:
            noises.append(w)
    lists = {"noise_train": [], "noise_val": [], "rir_train": [], "rir_val": []}
    for kind, files in (("noise", noises), ("rir", rirs)):
        for w in files:
            dst = out / kind / bucket(w.name) / (w.stem + ".wav")
            to16k(w, dst)
            lists[f"{kind}_{bucket(w.name)}"].append(dst)
    return lists


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speech", nargs="+", required=True, help="DIR:split  with split in train/val/test")
    ap.add_argument("--noise", required=True, help="directory containing RIRs and noises (e.g. datasets/rirs_noises)")
    ap.add_argument("--out", default="prepared")
    ap.add_argument("--max-files", type=int, help="use at most this many speech files per directory (fast first run, e.g. 3000)")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    lists = {**{f"speech_{k}": v for k, v in prepare_speech(a.speech, out, a.max_files).items()}, **prepare_noise_rir(a.noise, out)}
    (out / "lists").mkdir(parents=True, exist_ok=True)
    for k, v in lists.items():
        (out / "lists" / f"{k}.txt").write_text("\n".join(str(p.resolve()) for p in v) + ("\n" if v else ""))
        print(f"{k:14} {len(v):7d} files")
    empty = [k for k, v in lists.items() if not v and k not in ("speech_test",)]
    if empty:
        raise SystemExit(f"no files for: {empty}. Check the folder names/paths.")


if __name__ == "__main__":
    main()
