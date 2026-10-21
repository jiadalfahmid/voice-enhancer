import io, os, sys, tarfile, tempfile, unittest, zipfile, pathlib, subprocess
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import fetch_datasets as F
import prepare_data as P


def put_wav(path, sr, sec=1.0, seed=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    x = (np.random.default_rng(seed).standard_normal(int(sr * sec)) * 3000).astype(np.int16)
    wavfile.write(str(path), sr, x)


class DataTests(unittest.TestCase):
    def test_safe_extract_blocks_traversal_and_links(self):
        with tempfile.TemporaryDirectory() as d:
            bad = pathlib.Path(d) / "bad.tar"
            with tarfile.open(bad, "w") as t:
                info = tarfile.TarInfo("../evil.txt"); data = b"x"; info.size = 1
                t.addfile(info, io.BytesIO(data))
            with self.assertRaises(RuntimeError):
                F.safe_extract(bad, pathlib.Path(d) / "out")
            badzip = pathlib.Path(d) / "bad.zip"
            with zipfile.ZipFile(badzip, "w") as z:
                z.writestr("../evil.txt", "x")
            with self.assertRaises(RuntimeError):
                F.safe_extract(badzip, pathlib.Path(d) / "out2")
            good = pathlib.Path(d) / "good.tar.gz"
            with tarfile.open(good, "w:gz") as t:
                info = tarfile.TarInfo("a/b.txt"); info.size = 2; t.addfile(info, io.BytesIO(b"hi"))
            F.safe_extract(good, pathlib.Path(d) / "out3")
            self.assertEqual((pathlib.Path(d) / "out3/a/b.txt").read_text(), "hi")

    def test_registry_urls_and_aria2_command(self):
        for name, info in F.REGISTRY.items():
            urls = F.urls_for(info)
            self.assertEqual(len(urls), len(F.MIRRORS))
            self.assertTrue(all(u.startswith("https://") and "us.openslr.org" not in u for u in urls), name)
            if "sha256" in info:
                self.assertEqual(len(info["sha256"]), 64)
        cmd = F.aria2_cmd(["https://a/x.tar.gz", "https://b/x.tar.gz"], pathlib.Path("/tmp/d/x.tar.gz"))
        self.assertEqual(cmd[0], "aria2c")
        self.assertIn("-c", cmd)                       # resumable
        self.assertEqual(cmd[cmd.index("-o") + 1], "x.tar.gz")
        self.assertEqual(cmd[-2:], ["https://a/x.tar.gz", "https://b/x.tar.gz"])  # every mirror is passed

    def test_fetch_one_enforces_pinned_hash_and_extracts(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            arc = d / "src" / "pack.tar.gz"; arc.parent.mkdir()
            with tarfile.open(arc, "w:gz") as t:
                info = tarfile.TarInfo("spk/1/a.txt"); info.size = 2; t.addfile(info, io.BytesIO(b"hi"))
            good = F.sha256_of(arc)
            reg = {"toy": dict(urls=[arc.as_uri()], license="test", role="toy", sha256=good)}
            F.fetch_one("toy", d / "root", delete_archive=True, use_aria2=False, registry=reg)
            self.assertEqual((d / "root/toy/spk/1/a.txt").read_text(), "hi")
            self.assertFalse((d / "root/_downloads/pack.tar.gz").exists())  # --delete-archive
            self.assertEqual(F.load_manifest(d / "root")["toy"]["sha256"], good)
            bad = {"toy2": dict(urls=[arc.as_uri()], license="test", role="toy", sha256="0" * 64)}
            with self.assertRaises(SystemExit):
                F.fetch_one("toy2", d / "root2", use_aria2=False, registry=bad)

    def test_downloader_falls_back_to_next_mirror(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            ok = d / "ok.bin"; ok.write_bytes(b"data")
            out = F.download_urllib(["file:///nonexistent/zzz.bin", ok.as_uri()], d / "o" / "ok.bin", retries=1)
            self.assertEqual(out.read_bytes(), b"data")

    def test_sha256(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "x"; p.write_bytes(b"abc")
            self.assertEqual(F.sha256_of(p), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_prepare_resamples_splits_by_speaker_and_lists(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            for spk in ("101", "102"):
                put_wav(d / "raw/train-clean-100" / spk / "9000" / f"{spk}_a.wav", 24000, seed=int(spk))
            put_wav(d / "raw/dev-clean/201/9100/201_a.wav", 24000, seed=5)
            put_wav(d / "raw/test-clean/301/9200/301_a.wav", 24000, seed=6)
            for i in range(30):
                put_wav(d / "raw/rirs_noises/RIRS_NOISES/pointsource_noises" / f"noise-{i:03d}.wav", 16000, seed=i)
                put_wav(d / "raw/rirs_noises/RIRS_NOISES/simulated_rirs/smallroom/Room001" / f"Room001-{i:05d}.wav", 16000, 0.3, seed=i)
            out = d / "prepared"
            sp = P.prepare_speech([f"{d}/raw/train-clean-100:train", f"{d}/raw/dev-clean:val", f"{d}/raw/test-clean:test"], out)
            self.assertEqual(len(sp["train"]), 2); self.assertEqual(len(sp["val"]), 1); self.assertEqual(len(sp["test"]), 1)
            sr, x = wavfile.read(str(sp["train"][0]))
            self.assertEqual(sr, 16000); self.assertEqual(len(x), 16000)  # 1 s at 24 kHz -> 1 s at 16 kHz
            nr = P.prepare_noise_rir(d / "raw/rirs_noises", out)
            self.assertEqual(len(nr["noise_train"]) + len(nr["noise_val"]), 30)
            self.assertEqual(len(nr["rir_train"]) + len(nr["rir_val"]), 30)
            self.assertGreater(len(nr["noise_val"]), 0)
            # deterministic split
            nr2 = P.prepare_noise_rir(d / "raw/rirs_noises", out)
            self.assertEqual([p.name for p in nr["noise_val"]], [p.name for p in nr2["noise_val"]])

    def test_max_files_caps_per_directory_deterministically(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            for i in range(10):
                put_wav(d / "raw" / f"{100 + i % 5}" / "1" / f"u{i}.wav", 16000, seed=i)
            a = P.prepare_speech([f"{d}/raw:train"], d / "o1", max_files=4)
            b = P.prepare_speech([f"{d}/raw:train"], d / "o2", max_files=4)
            self.assertEqual(len(a["train"]), 4)
            self.assertEqual([p.name for p in a["train"]], [p.name for p in b["train"]])

    def test_prepare_refuses_overlapping_speakers(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            put_wav(d / "a/101/1/x.wav", 16000); put_wav(d / "b/101/2/y.wav", 16000)
            with self.assertRaises(SystemExit):
                P.prepare_speech([f"{d}/a:train", f"{d}/b:val"], d / "out")


if __name__ == "__main__":
    unittest.main()
