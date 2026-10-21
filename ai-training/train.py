"""Train / fine-tune a speech-enhancement model.

Fine-tune GTCRN on far-field + interfering-talker mixtures (recommended first run):
  python train.py --lists prepared/lists --arch gtcrn --gtcrn-dir ../gtcrn --init ../gtcrn/checkpoints/model_trained_on_dns3.tar \
                  --preset farfield --epochs 30 --steps-per-epoch 1000 --batch 16 --lr 2e-4 --out runs/gtcrn_ft1
Train the GRU baseline from scratch:
  python train.py --lists prepared/lists --arch gru --preset farfield --epochs 100 --lr 1e-3 --out runs/gru1
"""
import argparse
import math
import pathlib
import random
import time

import numpy as np
import torch
from torch.utils.data import DataLoader

import augment as A
from dataset import SEDataset
from losses import compressed_loss, mr_stft_loss, si_sdr
from model import build_model, istft, stft


def parse(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--lists", required=True)
    ap.add_argument("--arch", choices=["gtcrn", "gru"], default="gtcrn")
    ap.add_argument("--gtcrn-dir"); ap.add_argument("--init"); ap.add_argument("--resume")
    ap.add_argument("--hidden", type=int, default=256)
    ap.add_argument("--preset", choices=list(A.PRESETS), default="farfield")
    ap.add_argument("--target-mode", choices=["reverb", "early", "dry"], help="override the preset's target mode")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--steps-per-epoch", type=int, default=1000)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--clip-grad", type=float, default=5.0)
    ap.add_argument("--w-spec", type=float, default=1.0); ap.add_argument("--w-mr", type=float, default=0.3)
    ap.add_argument("--val-examples", type=int, default=200)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--amp", action="store_true", help="fp16 autocast for the model forward (STFT and losses stay fp32)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="runs/run")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--time-limit-min", type=float, default=0, help="stop cleanly after the epoch that would exceed this many minutes (0 = no limit); re-run with the same --out to resume")
    return ap.parse_args(argv)


def seed_everything(s):
    random.seed(s); np.random.seed(s); torch.manual_seed(s)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(s)


def step_loss(model, noisy, target, hop, args, amp):
    n = noisy.shape[-1]
    with torch.no_grad():
        X, S = stft(noisy, hop), stft(target, hop)
    with torch.autocast(device_type=noisy.device.type, dtype=torch.float16, enabled=amp):
        E = model(X)
    E = E.float()
    est = istft(E, hop, n)
    loss = args.w_spec * compressed_loss(E, S) + args.w_mr * mr_stft_loss(est, target)
    return loss, est


HF_BANDS = (("3-5k", 96, 160), ("5-7k", 160, 224), ("7-8k", 224, 257))  # FFT-512 bins at 16 kHz (31.25 Hz each)


def band_db(est, ref):
    """Energy of est relative to ref (dB) per high-frequency band, per example. Strongly negative = the model is dulling the voice."""
    pe = stft(est, 256).pow(2).sum(-1).sum(-1)
    pr = stft(ref, 256).pow(2).sum(-1).sum(-1)
    return {n: 10 * torch.log10(pe[:, a:b].sum(1) / (pr[:, a:b].sum(1) + 1e-9) + 1e-9) for n, a, b in HF_BANDS}


def evaluate(model, loader, hop, args, device):
    model.eval()
    tot, sdr, cnt, nsdr = 0.0, 0.0, 0, 0
    hf = {n: 0.0 for n, _, _ in HF_BANDS}
    with torch.no_grad():
        for noisy, target in loader:
            noisy, target = noisy.to(device), target.to(device)
            loss, est = step_loss(model, noisy, target, hop, args, False)
            tot += float(loss) * len(noisy); cnt += len(noisy)
            voiced = target.pow(2).mean(-1) > 1e-6  # SI-SDR is undefined for silent targets
            if voiced.any():
                sdr += float(si_sdr(est[voiced], target[voiced]).sum()); nsdr += int(voiced.sum())
                for n, v in band_db(est[voiced], target[voiced]).items():
                    hf[n] += float(v.sum())
    model.train()
    return tot / max(cnt, 1), sdr / max(nsdr, 1), {n: v / max(nsdr, 1) for n, v in hf.items()}


def main(argv=None):
    args = parse(argv)
    seed_everything(args.seed)
    device = torch.device("cuda" if args.device == "auto" and torch.cuda.is_available() else ("cpu" if args.device == "auto" else args.device))
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    cfg = A.PRESETS[args.preset]
    if args.target_mode:
        cfg = A.with_preset(args.preset, target_mode=args.target_mode)
    model, hop = build_model(args.arch, args.gtcrn_dir, args.init, args.hidden)
    model.to(device).train()
    n_params = sum(p.numel() for p in model.parameters())
    print(f"arch {args.arch}  params {n_params:,}  hop {hop}  device {device}  preset {args.preset}  target {cfg.target_mode}", flush=True)

    train_ds = SEDataset(args.lists, "train", cfg, args.steps_per_epoch * args.batch, seed=args.seed)
    val_ds = SEDataset(args.lists, "val", cfg, args.val_examples, seed=12345, fixed=True)
    mk = lambda ds, shuffle: DataLoader(ds, batch_size=args.batch, shuffle=shuffle, num_workers=args.workers, drop_last=shuffle)
    val_loader = mk(val_ds, False)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    total = args.epochs * args.steps_per_epoch
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / args.warmup) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total))))
    use_amp = args.amp and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    try:
        from torch.utils.tensorboard import SummaryWriter
        tb = SummaryWriter(str(out / "tb"))
    except Exception:  # tensorboard is optional
        tb = None

    t_start = time.time()
    start_epoch, best, step = 0, float("inf"), 0
    if args.resume:
        ck = torch.load(args.resume, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"]); opt.load_state_dict(ck["opt"]); sched.load_state_dict(ck["sched"])
        start_epoch, best, step = ck["epoch"] + 1, ck["best"], ck["step"]

    for epoch in range(start_epoch, args.epochs):
        train_ds.set_epoch(epoch)
        t0, run = time.time(), 0.0
        for i, (noisy, target) in enumerate(mk(train_ds, True)):
            noisy, target = noisy.to(device), target.to(device)
            loss, _ = step_loss(model, noisy, target, hop, args, use_amp)
            if not torch.isfinite(loss):
                print("non-finite loss, skipping step", flush=True); opt.zero_grad(set_to_none=True); continue
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
            scaler.step(opt); scaler.update(); sched.step()
            run += float(loss.detach()); step += 1
            if (i + 1) % 100 == 0:
                print(f"epoch {epoch} step {i + 1}/{args.steps_per_epoch} loss {run / (i + 1):.4f} lr {sched.get_last_lr()[0]:.2e}", flush=True)
        vloss, vsdr, vhf = evaluate(model, val_loader, hop, args, device)
        print(f"== epoch {epoch}: train {run / max(1, i + 1):.4f}  val loss {vloss:.4f}  val SI-SDR {vsdr:.2f} dB  ({time.time() - t0:.0f}s)", flush=True)
        print("   high-band energy vs clean target (dB, 0 = ideal, very negative = dull): " + "  ".join(f"{n} {v:+.1f}" for n, v in vhf.items()), flush=True)
        if tb:
            tb.add_scalar("val/loss", vloss, epoch); tb.add_scalar("val/si_sdr", vsdr, epoch); tb.add_scalar("train/loss", run / max(1, i + 1), epoch)
            for n, v in vhf.items():
                tb.add_scalar(f"val/hf_{n}", v, epoch)
        state = dict(model=model.state_dict(), opt=opt.state_dict(), sched=sched.state_dict(), epoch=epoch, best=min(best, vloss),
                     step=step, args=vars(args), val_loss=vloss, val_si_sdr=vsdr)
        torch.save(state, out / "last.pt")
        if vloss < best:
            best = vloss
            torch.save(dict(state, best=best), out / "best.pt")
            print("   new best", flush=True)
        if args.time_limit_min and (time.time() - t_start) / 60 + (time.time() - t0) / 60 * 1.15 > args.time_limit_min:
            print(f"time limit ({args.time_limit_min:.0f} min) reached after epoch {epoch}; re-run with the same --out to resume.", flush=True)
            break
    return out


if __name__ == "__main__":  # the guard matters on Windows (DataLoader workers re-import this file)
    main()
