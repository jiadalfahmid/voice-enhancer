import os, sys, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import augment as A
from audio_io import SR


def speechlike(sec, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(sec * SR)) / SR
    f0 = 120 + 25 * np.sin(2 * np.pi * 3 * t)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    x = sum(np.sin(h * ph) / h * np.exp(-(((h * f0 - 800) / 1200) ** 2)) for h in range(1, 25))
    env = np.clip(np.sin(2 * np.pi * 2.5 * t + seed), 0, None) ** 0.7
    return (x * env + 0.001 * rng.standard_normal(len(t))).astype(np.float32)


def rir(rt60=0.6, sec=0.8, seed=1):
    rng = np.random.default_rng(seed)
    n = int(sec * SR)
    h = np.zeros(n)
    h[0] = 1.0
    i = np.arange(40, n)
    h[40:] = 0.35 * rng.standard_normal(len(i)) * 10 ** (-3 * (i / SR) / rt60)
    return h


def tail_to_speech(y, starts, sr=SR):
    sp = np.mean([A.rms(y[s + 2000:s + 7000]) ** 2 for s in starts])
    tl = np.mean([A.rms(y[s + int(0.62 * sr):s + int(0.9 * sr)]) ** 2 for s in starts])
    return 10 * np.log10(tl / sp)


class AugmentTests(unittest.TestCase):
    def test_snr_is_accurate(self):
        rng = np.random.default_rng(0)
        c, n = speechlike(3), rng.standard_normal(3 * SR).astype(np.float32)
        for snr in (-5, 5, 20):
            mixed, scaled = A.mix_at_snr(c, n, snr)
            self.assertAlmostEqual(20 * np.log10(A.rms(c) / A.rms(scaled)), snr, delta=0.05)
            np.testing.assert_allclose(mixed, c + scaled, atol=1e-6)

    def test_rir_alignment_and_modes(self):
        x = np.random.default_rng(11).standard_normal(4 * SR).astype(np.float32)  # broadband: unambiguous lag
        h = np.concatenate([np.zeros(137), rir()])  # direct path is NOT at index 0
        wet, tgt_rev = A.apply_rir(x, h, "reverb")
        wet2, tgt_early = A.apply_rir(x, h, "early")
        _, tgt_dry = A.apply_rir(x, h, "dry")
        np.testing.assert_allclose(wet, tgt_rev)
        np.testing.assert_allclose(tgt_dry, x)
        # direct path aligned: zero lag between dry and reverberant/early versions
        for y in (wet, tgt_early):
            c = np.correlate(y[:20000], x[:20000], "full")
            self.assertEqual(int(np.argmax(c)) - 19999, 0)
        # early target has a far smaller tail than the reverberant signal
        starts = [int(0.3 * SR), int(1.7 * SR), int(3.1 * SR)]
        burst = np.zeros(5 * SR, np.float32)
        for s in starts:
            burst[s:s + int(0.5 * SR)] = speechlike(0.5, seed=s)[: int(0.5 * SR)]
        w, e = A.apply_rir(burst, h, "early")[0], A.apply_rir(burst, h, "early")[1]
        self.assertLess(tail_to_speech(e, starts), tail_to_speech(w, starts) - 6)

    def test_bandlimit(self):
        x = np.random.default_rng(0).standard_normal(4 * SR).astype(np.float32)
        y = A.bandlimit(x, 4000)
        X, Y = np.abs(np.fft.rfft(x)) ** 2, np.abs(np.fft.rfft(y)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        self.assertLess(10 * np.log10(Y[f > 5000].sum() / X[f > 5000].sum()), -50)
        self.assertGreater(10 * np.log10(Y[f < 3000].sum() / X[f < 3000].sum()), -0.5)

    def test_tilt_range(self):
        x = np.random.default_rng(0).standard_normal(8 * SR).astype(np.float32)
        y = A.tilt_eq(x, 6.0)
        X, Y = np.abs(np.fft.rfft(x)) ** 2, np.abs(np.fft.rfft(y)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        gain = lambda lo, hi: 10 * np.log10(Y[(f > lo) & (f < hi)].sum() / X[(f > lo) & (f < hi)].sum())
        self.assertGreater(gain(7000, 7900), 4.5)
        self.assertLess(gain(60, 100), -3.5)
        self.assertLess(abs(gain(900, 1100)), 1.5)

    def test_clip_reaches_full_scale_and_keeps_rms(self):
        x = speechlike(3) * 0.1
        y = A.hard_clip(x, np.random.default_rng(3))
        self.assertAlmostEqual(A.rms(y), A.rms(x), delta=0.01 * A.rms(x) + 1e-6)
        self.assertGreater(np.mean(np.abs(y) >= 0.9 * np.max(np.abs(y))), np.mean(np.abs(x) >= 0.9 * np.max(np.abs(x))))

    @unittest.skipUnless(A.have_ffmpeg(), "ffmpeg not installed")
    def test_codec_roundtrip_is_aligned(self):
        x = speechlike(4, seed=5) * 0.3
        for codec in ("mp3", "opus", "aac"):
            y = A.codec_roundtrip(x, codec, 48)
            self.assertEqual(len(y), len(x))
            c = np.correlate(y[8000:30000], x[8000:30000], "full")
            self.assertLessEqual(abs(int(np.argmax(c)) - 21999), 2, codec)
            self.assertGreater(np.corrcoef(x[8000:60000], y[8000:60000])[0, 1], 0.9, codec)

    def test_make_example_basic_properties(self):
        rng_a, rng_b = np.random.default_rng(7), np.random.default_rng(7)
        sp, nz, other = speechlike(8, 1), np.random.default_rng(2).standard_normal(8 * SR).astype(np.float32), speechlike(8, 2)
        cfg = A.with_preset("farfield", p_codec=0.0)
        n1, t1 = A.make_example(sp, nz, [rir()], rng_a, cfg, interferer=other, interferer_rirs=[rir(0.4)])
        n2, t2 = A.make_example(sp, nz, [rir()], rng_b, cfg, interferer=other, interferer_rirs=[rir(0.4)])
        np.testing.assert_array_equal(n1, n2)  # deterministic for a seed
        np.testing.assert_array_equal(t1, t2)
        self.assertEqual(len(n1), int(cfg.crop_seconds * SR))
        self.assertLessEqual(max(np.abs(n1).max(), np.abs(t1).max()), 0.99 + 1e-6)

    def test_no_reverb_no_interferer_target_is_scaled_speech_and_pure_cases(self):
        sp, nz = speechlike(8, 1), np.random.default_rng(2).standard_normal(8 * SR).astype(np.float32)
        cfg = A.AugConfig(p_reverb=0.0, p_pure=0.0, p_clip=0, p_codec=0, p_eq=0, p_bandlimit=0)
        noisy, target = A.make_example(sp, nz, [], np.random.default_rng(1), cfg)
        # the target is the same speech as in the noisy input: noisy - target must be (scaled) noise only
        cfg2 = A.AugConfig(p_reverb=0.0, p_pure=0.0, p_clip=0, p_codec=0, p_eq=0, p_bandlimit=0, snr_db=(10, 10))
        noisy, target = A.make_example(sp, nz, [], np.random.default_rng(1), cfg2)
        self.assertAlmostEqual(A.rms(noisy - target) / A.rms(target), 10 ** (-10 / 20), delta=0.02)  # exactly 10 dB SNR
        # pure cases
        silent = [A.make_example(sp, nz, [], np.random.default_rng(s), A.AugConfig(p_pure=1.0))[1] for s in range(20)]
        ident = [A.make_example(sp, nz, [], np.random.default_rng(s), A.AugConfig(p_pure=1.0)) for s in range(20)]
        self.assertTrue(any(np.allclose(t, 0) for t in silent))
        self.assertTrue(any(np.allclose(a, b) and not np.allclose(b, 0) for a, b in ident))

    def test_interferer_never_leaks_into_target(self):
        sp = speechlike(8, 1)
        other = 0.5 * speechlike(8, 9)
        nz = np.zeros(8 * SR, np.float32) + 1e-6
        cfg = A.AugConfig(p_reverb=0.0, p_pure=0.0, p_interferer=1.0, p_clip=0, p_codec=0, p_eq=0, p_bandlimit=0, sir_db=(0, 0), snr_db=(60, 60))
        noisy, target = A.make_example(sp, nz, [], np.random.default_rng(4), cfg, interferer=other)
        # target contains only the target speaker; the interferer must add energy to the noisy input
        self.assertGreater(A.rms(noisy - target) / A.rms(target), 0.5)


if __name__ == "__main__":
    unittest.main()
