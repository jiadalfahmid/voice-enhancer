"""Losses from the PRD: power-law compressed spectral loss (magnitude + complex, c=0.3) and a multi-resolution
STFT loss. SI-SDR is provided as a validation metric only (undefined for silent targets)."""
import torch
import torch.nn.functional as F


def _mag(spec):
    return torch.sqrt(spec.pow(2).sum(-1).clamp_min(1e-12))


def compressed_loss(est, ref, c=0.3):
    """est/ref: [B, F, T, 2]."""
    me, mr = _mag(est), _mag(ref)
    l_mag = F.mse_loss(me.pow(c), mr.pow(c))
    ce = est * me.pow(c - 1).unsqueeze(-1)
    cr = ref * mr.pow(c - 1).unsqueeze(-1)
    return l_mag + F.mse_loss(ce, cr)


def mr_stft_loss(est, ref, sizes=((512, 128), (1024, 256), (2048, 512))):
    """est/ref: [B, N] waveforms. Log-magnitude L1 + linear-magnitude L1 (robust for silent targets)."""
    total = 0.0
    for n, h in sizes:
        w = torch.hann_window(n, device=est.device)
        se = torch.stft(est, n, h, n, w, return_complex=True).abs()
        sr = torch.stft(ref, n, h, n, w, return_complex=True).abs()
        total = total + F.l1_loss(torch.log(se + 1e-5), torch.log(sr + 1e-5)) + F.l1_loss(se, sr)
    return total / len(sizes)


def si_sdr(est, ref, eps=1e-8):
    ref = ref - ref.mean(-1, keepdim=True)
    est = est - est.mean(-1, keepdim=True)
    proj = (est * ref).sum(-1, keepdim=True) / (ref.pow(2).sum(-1, keepdim=True) + eps) * ref
    noise = est - proj
    return 10 * torch.log10((proj.pow(2).sum(-1) + eps) / (noise.pow(2).sum(-1) + eps))
