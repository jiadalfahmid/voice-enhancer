# Baseline: stand-in model (GTCRN) on a real clip

Clip: "Rejected - scene 3 take 1" (34.9 s, stereo, 192 kbps MP3 from a camera). Output exported from the web app
(m1e or later; stereo channels identical, so Centre-the-voice was on; other polish settings and the loudness target
were not recorded). Produced with `python bench_clips.py --orig ... --enh ...`.

| Metric | Original | Enhanced |
| --- | --- | --- |
| Loudness (LUFS) | -21.7 | -12.6 |
| Quiet frames p10 (dBFS) | -32.4 | -68.2 |
| Loud frames p90 (dBFS) | -22.4 | -11.0 |
| Speech-to-floor (dB) | 10.1 | 57.1 |
| 30 dB decay, median (ms, capped at 3000) | 3000.0 | 350.0 |
| Side/mid (dB) | -7.9 | -inf |

- Speech-to-floor improvement (loudness-independent): **47.1 dB**
- Share of decays that never fell 30 dB: original 0.92, enhanced 0.00
- Band change in loud frames, relative to the overall gain (dB): 100-300 Hz -0.6, 300-1000 Hz +0.4, 1000-3000 Hz -1.1, 3000-5000 Hz +1.8, 5000-7000 Hz -1.1, 7000-8000 Hz -4.0, 8000-12000 Hz -4.8, 12000-20000 Hz -8.3

Reading: the model removes steady background noise very effectively (floor), but the room tail still takes a median
~350 ms to fall 30 dB, other talkers remain (reported by listening, not measured), and energy above 7 kHz is reduced by 4-8 dB. Targets for the next model:
decay well under 200 ms, other talkers attenuated, no loss above 4 kHz (ideally restored).
Add every future model's numbers on the same clip(s) to this file.


## Bangla clip (test-bangla.mp3, 40 s, noisy, AAC camera/phone audio) - 2026-10-12
`bench_clips.py` on the original vs. (a) the pretrained GTCRN run offline in Python and (b) the user's `ft1` output from the
Colab checkpoint. IMPORTANT: that checkpoint came from a 2 x 20-step test run (batch 4), i.e. 40 training steps, not the real
fine-tune (the first real run failed because the data lists were empty when it started).

| | pretrained GTCRN | ft1 (40 steps) |
| --- | --- | --- |
| speech-to-floor improvement (dB) | 36.4 | 41.3 |
| 30 dB decay, median (ms; original never decays, capped 3000) | 1500 | 660 |
| band change vs overall (dB): 3-5 k / 5-7 k / 7-8 k | -6.8 / -1.2 / -8.9 | -10.0 / -4.6 / -15.3 |

Reading: even 40 steps move the model toward more denoising and a shorter echo tail, but it also dulls 3-8 kHz further.
The real run prints a per-epoch "high-band energy vs clean target" line (train.py) so this is visible during training.
The ft1 file and the pretrained output differ by only about 11 dB (they are related, not the same).
