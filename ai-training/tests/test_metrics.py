import os, sys, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import metrics as M
from test_augment import speechlike, rir
from augment import apply_rir

FS = 16000


class MetricsTests(unittest.TestCase):
    def test_lufs_reference_tone(self):  # EBU 3341 case 1: stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS
        fs = 48000
        t = np.arange(fs * 20) / fs
        x = np.stack([10 ** (-23 / 20) * np.sin(2 * np.pi * 1000 * t)] * 2, 1)
        self.assertAlmostEqual(M.lufs(x, fs), -23.0, delta=0.1)

    def test_identical_clips_have_no_change(self):
        x = np.stack([speechlike(20, 3)] * 2, 1).astype(np.float64)
        r = M.compare(x, x, FS)
        self.assertAlmostEqual(r["speech_to_floor_gain_db"], 0.0, places=6)
        for v in r["band_change_db"].values():
            self.assertAlmostEqual(v, 0.0, places=6)

    def test_pure_gain_reads_zero_band_change(self):
        x = np.stack([speechlike(20, 4)] * 2, 1).astype(np.float64)
        r = M.compare(x, x * 3.0, FS)
        self.assertAlmostEqual(r["speech_to_floor_gain_db"], 0.0, places=4)  # loudness does not move the floor metric
        for v in r["band_change_db"].values():
            self.assertAlmostEqual(v, 0.0, places=5)

    def test_decay_metric_sees_reverb(self):
        n = 12 * FS
        dry = np.zeros(n, np.float32)
        for k in range(6):
            s0 = int((0.3 + k * 1.9) * FS)
            dry[s0:s0 + FS // 2] = speechlike(0.5, k)[: FS // 2]
        wet = apply_rir(dry, rir(0.8, 1.2), "reverb")[0]
        d_dry, _ = M.decay_ms(dry, FS)
        d_wet, _ = M.decay_ms(wet, FS)
        self.assertGreater(d_wet, d_dry + 80)

    def test_side_to_mid(self):
        x = speechlike(10, 2).astype(np.float64)
        self.assertEqual(M.analyze(np.stack([x, x], 1), FS)["side_to_mid_db"], float("-inf"))
        side = M.analyze(np.stack([x, 0.5 * x], 1), FS)["side_to_mid_db"]
        self.assertAlmostEqual(side, 20 * np.log10(0.5 / 1.5), delta=0.1)


if __name__ == "__main__":
    unittest.main()
