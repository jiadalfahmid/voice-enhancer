"""On-the-fly synthetic mixing dataset. Deterministic: example i of epoch e always gets the same random draws,
validation uses epoch 0 forever so the validation set never changes."""
import pathlib

import numpy as np
import torch
from torch.utils.data import Dataset

import augment as A
from audio_io import load_16k


def read_list(path):
    p = pathlib.Path(path)
    return [l.strip() for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


class SEDataset(Dataset):
    def __init__(self, lists_dir, split, cfg, length, seed=0, fixed=False):
        d = pathlib.Path(lists_dir)
        self.speech = read_list(d / f"speech_{split}.txt")
        self.noise = read_list(d / f"noise_{'train' if split == 'train' else 'val'}.txt")
        self.rirs = read_list(d / f"rir_{'train' if split == 'train' else 'val'}.txt")
        if not self.speech or not self.noise:
            raise SystemExit(f"empty speech/noise lists for split {split} in {d}")
        self.speakers = [pathlib.Path(p).parent.name for p in self.speech]
        self.cfg, self.length, self.seed, self.fixed, self.epoch = cfg, length, seed, fixed, 0

    def set_epoch(self, e):
        self.epoch = e

    def __len__(self):
        return self.length

    def __getitem__(self, i):
        rng = np.random.default_rng([self.seed, 0 if self.fixed else self.epoch, i])
        k = int(rng.integers(len(self.speech)))
        speech = load_16k(self.speech[k])
        noise = load_16k(self.noise[int(rng.integers(len(self.noise)))])
        rirs = [load_16k(self.rirs[int(j)]) for j in rng.integers(len(self.rirs), size=3)] if self.rirs else []
        other = other_rirs = None
        if self.cfg.p_interferer > 0 and len(set(self.speakers)) > 1:
            for _ in range(8):  # a different speaker, always
                j = int(rng.integers(len(self.speech)))
                if self.speakers[j] != self.speakers[k]:
                    other = load_16k(self.speech[j])
                    other_rirs = rirs
                    break
        noisy, target = A.make_example(speech, noise, rirs, rng, self.cfg, interferer=other, interferer_rirs=other_rirs)
        return torch.from_numpy(noisy), torch.from_numpy(target)
