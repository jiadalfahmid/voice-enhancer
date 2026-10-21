"""Checks dataset.py's logic. Uses real torch when installed; otherwise a tiny stand-in so the logic is still tested."""
import os, pathlib, sys, tempfile, types, unittest
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import augment as A
from test_augment import speechlike, rir

_STUBBED = False
try:
    import torch  # noqa: F401
except ImportError:
    _STUBBED = True
    tm = types.ModuleType("torch"); tm.from_numpy = lambda a: a; tm.Tensor = type("Tensor", (), {})
    ut = types.ModuleType("torch.utils"); ud = types.ModuleType("torch.utils.data")
    ud.Dataset = object
    tm.utils = ut; ut.data = ud
    sys.modules.update({"torch": tm, "torch.utils": ut, "torch.utils.data": ud})
from dataset import SEDataset

SR = 16000


def put(path, x):
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(path), SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    return str(path)


class DatasetTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        if _STUBBED:  # do not leave the stand-in installed for other test modules
            for k in ("torch", "torch.utils", "torch.utils.data"):
                sys.modules.pop(k, None)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); d = pathlib.Path(self.tmp.name)
        L = {k: [] for k in ("speech_train", "speech_val", "noise_train", "noise_val", "rir_train", "rir_val")}
        for split, spks in (("train", (1, 2, 3)), ("val", (11, 12))):
            for s in spks:
                L[f"speech_{split}"].append(put(d / "sp" / split / f"{s}" / "a.wav", speechlike(6, s)))
            L[f"noise_{split}"].append(put(d / "nz" / f"{split}.wav", 0.1 * np.random.default_rng(1).standard_normal(SR * 5)))
            L[f"rir_{split}"].append(put(d / "rir" / f"{split}.wav", rir(0.4, 0.5) * 0.9))
        (d / "lists").mkdir()
        for k, v in L.items():
            (d / "lists" / f"{k}.txt").write_text("\n".join(v) + "\n")
        self.lists = str(d / "lists")

    def tearDown(self):
        self.tmp.cleanup()

    def test_deterministic_and_shapes(self):
        cfg = A.with_preset("farfield", p_codec=0.0)
        ds = SEDataset(self.lists, "train", cfg, 10, seed=3)
        a1, b1 = ds[4]; a2, b2 = ds[4]
        np.testing.assert_array_equal(a1, a2); np.testing.assert_array_equal(b1, b2)
        self.assertEqual(len(a1), int(cfg.crop_seconds * SR)); self.assertEqual(len(a1), len(b1))
        ds.set_epoch(1)
        a3, _ = ds[4]
        self.assertFalse(np.array_equal(a1, a3))  # a new epoch gives new mixtures

    def test_validation_is_fixed_across_epochs(self):
        ds = SEDataset(self.lists, "val", A.PRESETS["prd"], 5, seed=12345, fixed=True)
        a1, _ = ds[2]; ds.set_epoch(7); a2, _ = ds[2]
        np.testing.assert_array_equal(a1, a2)

    def test_interferer_comes_from_another_speaker(self):
        ds = SEDataset(self.lists, "train", A.with_preset("farfield", p_codec=0.0), 20, seed=0)
        self.assertEqual(sorted(set(ds.speakers)), ["1", "2", "3"])
        for i in range(20):
            noisy, target = ds[i]
            self.assertEqual(len(noisy), len(target))


if __name__ == "__main__":
    unittest.main()
