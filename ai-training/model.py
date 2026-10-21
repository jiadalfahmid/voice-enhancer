"""Models and STFT helpers for training. Spectra are [B, F=257, T, 2] (re, im), FFT 512, sqrt-Hann, 16 kHz.

arch "gtcrn": the public GTCRN (MIT) from a local clone of Xiaobin-Rong/gtcrn, hop 256. Fine-tune it from its
              pretrained checkpoint (--init) so training starts from a model that already works in the web app.
arch "gru"  : causal Linear -> GRU -> complex mask (hop 160, ~0.9 M parameters at hidden=256). The mask is
              complex and may exceed 1, so unlike a 0-1 mask it can add back energy (clarity / bandwidth).
"""
import sys

import torch
import torch.nn as nn

N_FFT = 512
N_BINS = 257
ARCH_HOP = {"gtcrn": 256, "gru": 160}


def _window(x):
    return torch.hann_window(N_FFT, device=x.device, dtype=torch.float32).pow(0.5)


def stft(x, hop):
    """x [B, N] -> [B, F, T, 2]"""
    spec = torch.stft(x, N_FFT, hop, N_FFT, window=_window(x), center=True, return_complex=True)
    return torch.view_as_real(spec)


def istft(spec, hop, length):
    """spec [B, F, T, 2] -> [B, length]"""
    z = torch.view_as_complex(spec.contiguous())
    return torch.istft(z, N_FFT, hop, N_FFT, window=_window(spec), center=True, length=length)


class CausalGruSE(nn.Module):
    def __init__(self, hidden=256, layers=2):
        super().__init__()
        self.inp = nn.Linear(N_BINS, hidden)
        self.gru = nn.GRU(hidden, hidden, num_layers=layers, batch_first=True)
        self.out = nn.Linear(hidden, 2 * N_BINS)
        nn.init.normal_(self.out.weight, std=1e-3)  # start close to identity (mask ~ 1 + 0j)
        nn.init.zeros_(self.out.bias)

    def forward(self, spec):
        b, f, t, _ = spec.shape
        mag = torch.sqrt(spec.pow(2).sum(-1) + 1e-8)           # [B, F, T]
        h, _ = self.gru(torch.relu(self.inp(torch.log1p(mag).transpose(1, 2))))  # [B, T, H]
        m = self.out(h).view(b, t, 2, f)
        mr = (1.0 + 1.5 * torch.tanh(m[:, :, 0])).transpose(1, 2)   # [B, F, T], range -0.5 .. 2.5
        mi = (1.5 * torch.tanh(m[:, :, 1])).transpose(1, 2)
        re, im = spec[..., 0], spec[..., 1]
        return torch.stack([mr * re - mi * im, mr * im + mi * re], dim=-1)


def load_state(path):
    try:
        ck = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:  # older checkpoints that hold more than tensors; only load files you trust
        ck = torch.load(path, map_location="cpu", weights_only=False)
    return ck["model"] if isinstance(ck, dict) and "model" in ck else ck


def build_model(arch, gtcrn_dir=None, init=None, hidden=256):
    if arch == "gtcrn":
        if not gtcrn_dir:
            raise SystemExit("--gtcrn-dir is required for arch gtcrn (path to a clone of github.com/Xiaobin-Rong/gtcrn)")
        sys.path.insert(0, str(gtcrn_dir))
        from gtcrn import GTCRN  # noqa: E402
        model = GTCRN()
    elif arch == "gru":
        model = CausalGruSE(hidden=hidden)
    else:
        raise SystemExit(f"unknown arch {arch}")
    if init:
        model.load_state_dict(load_state(init))
    return model, ARCH_HOP[arch]
