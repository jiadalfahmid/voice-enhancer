# ai-training (M3: data and training)

Goal: a model that removes noise, other talkers and room echo and restores clarity, replacing the stand-in GTCRN.
Plan (see docs/BASELINE.md for the numbers to beat):

1. **Track A, fine-tune GTCRN** on far-field + interfering-talker mixtures. Fast, and the result drops straight into the
   web app (same ONNX interface, hop 256). Expect a clear gain on echo and background voices; its size (about 24 K
   parameters) limits how far it can go.
2. **Track B, train a larger model from scratch** (`--arch gru`, then wider/deeper once Track A shows the data works).
   Its complex mask can exceed 1, so it can add back lost high frequencies, which a 0-1 mask cannot.

Decisions baked in (change in `augment.py` presets / flags):
- Target mode `early` (direct sound + first 50 ms of the room) for the `farfield` preset: removes echo tails but keeps
  the voice natural. `--target-mode dry` is the stronger, riskier option; `reverb` is the PRD's safe default.
- Inputs are degraded (EQ tilt, band-limit to 3.5-8 kHz, MP3/Opus/AAC round trip, clipping, other talkers 0-20 dB
  below the target, RIRs) while targets stay clean and full-band, so the model learns to undo all of it.
- The PRD's `prd` preset (20% reverb, no interfering talkers) is available with `--preset prd`.

## Kaggle (primary, free GPU): use ../kaggle/train_kaggle.ipynb
Upload the project zip as a private Kaggle Dataset, add it as input, enable GPU + Internet (phone verification needed), Run All to test, then
Save Version > Save & Run All (Commit) to train in the background. The notebook downloads data with aria2c (3 mirrors, pinned SHA-256), stops itself
before the session limit, and can resume from a previous version's output. Install aria2 on your own PC with `choco install aria2` (or `apt-get install aria2`).

## Colab (backup): use ../colab/02_train.ipynb
It runs all the steps below on a free GPU, saves checkpoints to Google Drive and resumes after disconnects.
Prefer LibriTTS-R (restored LibriTTS, CC BY 4.0) as the clean target: `fetch_datasets.py fetch libritts_r_train_clean_100 ...`.

## Steps on your own PC (Windows, Git Bash)
```
cd ai-training
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
pip install torch            # use the exact command from https://pytorch.org/get-started/locally/ (CUDA or CPU build)
git clone https://github.com/Xiaobin-Rong/gtcrn ../gtcrn

python -m unittest discover -s tests          # data/augmentation tests (no GPU needed)
python smoke_test.py --gtcrn-dir ../gtcrn     # tiny end-to-end run on the CPU: run this BEFORE anything else
```
Send me the output of the smoke test. The PyTorch code (model, losses, dataset, train, infer) is written but has not
been executed by me (no PyTorch in my environment); the smoke test is how we find the first bug quickly.

Then, once the smoke test passes:
```
python fetch_datasets.py fetch libritts_train_clean_100 libritts_dev_clean libritts_test_clean rirs_noises
python prepare_data.py --speech datasets/libritts_train_clean_100:train datasets/libritts_dev_clean:val \
       datasets/libritts_test_clean:test --noise datasets/rirs_noises --out prepared
python train.py --lists prepared/lists --arch gtcrn --gtcrn-dir ../gtcrn \
       --init ../gtcrn/checkpoints/model_trained_on_dns3.tar --preset farfield \
       --epochs 12 --steps-per-epoch 1000 --batch 16 --lr 2e-4 --out runs/gtcrn_ft1
python infer.py --ckpt runs/gtcrn_ft1/best.pt --arch gtcrn --gtcrn-dir ../gtcrn --inp YOUR_CLIP.mp3 --out clip-ft1.wav
python bench_clips.py --orig YOUR_CLIP.mp3 --enh clip-ft1.wav
```
Also download VCTK (CC BY 4.0) by hand if you want more speakers: see `python fetch_datasets.py list`.
Check every dataset's license in LICENSES.md before shipping a model trained on it (MUSAN-derived noises inside
`rirs_noises` have per-clip licenses; LibriTTS is CC BY 4.0, which requires attribution in the app).

## Files
`augment.py` degradations | `dataset.py` | `model.py` (GTCRN loader + GRU model) | `losses.py` (compressed spectral,
multi-resolution STFT, SI-SDR) | `train.py` | `infer.py` | `metrics.py` + `bench_clips.py` (real-clip comparison, tested) |
`fetch_datasets.py`, `prepare_data.py` | `tests/` (21 tests, pass without PyTorch).
`train.py` flags worth knowing: `--time-limit-min` (stop cleanly, resume later), `--resume`, `--amp`, `--target-mode early|dry|reverb`, `--preset farfield|prd`.
Per epoch it prints val loss, SI-SDR and the high-band energy vs the clean target (3-5k / 5-7k / 7-8k): very negative = dull voice.
Not done yet: DNSMOS/PESQ evaluation (`eval.py`), stateful ONNX export and parity test, int8 quantization (M4).
Model selection is by validation loss and SI-SDR for now; the PRD wants DNSMOS, which needs Microsoft's DNSMOS models.
