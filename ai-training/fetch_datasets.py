"""Download, hash and unpack the training data. Every download is recorded in datasets/MANIFEST.json
(url, bytes, sha256, date): that is the hash column of LICENSES.md. Hashes are trust-on-first-use; commit the
manifest so later downloads can be compared.

  python fetch_datasets.py list
  python fetch_datasets.py fetch libritts_train_clean_100 libritts_dev_clean libritts_test_clean rirs_noises
  python fetch_datasets.py verify
Check each dataset's license against LICENSES.md BEFORE training a model you plan to ship.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

# openslr.org mirrors that serve the same files. NOTE: us.openslr.org has a mismatched TLS certificate (seen 2026-10-12), do not use it.
MIRRORS = ["https://www.openslr.org", "https://openslr.elda.org", "https://openslr.trmal.net"]

# sha256 values were recorded by the project owner's first download on 2026-10-12 (trust on first use) and are
# enforced on every later download so Colab, Kaggle and a PC all get byte-identical data.
REGISTRY = {
    # LibriTTS-R = LibriTTS with the sound quality restored (same utterances): cleaner, fuller-band targets. Preferred.
    "libritts_r_train_clean_100": dict(path="/resources/141/train_clean_100.tar.gz", license="CC BY 4.0",
                                       sha256="6f0cef20fb1e72928f21f00711d8cda7acb2049fd1cef78c98e0c2db77de2547",
                                       role="speech (train), restored quality, 8.1 GB", note="a few files failed restoration; see openslr.org/141"),
    "libritts_r_dev_clean": dict(path="/resources/141/dev_clean.tar.gz", license="CC BY 4.0",
                                 sha256="02ea52de47ca670d7ad86e714a6c58b207660a3f8a371ad102156776d2262a0c",
                                 role="speech (val), restored quality, 1.3 GB"),
    "libritts_r_test_clean": dict(path="/resources/141/test_clean.tar.gz", license="CC BY 4.0",
                                  sha256="d4a2a7cdeeb68a6cfd628559739879bcb29556364cc13f38413930d59369a7f1",
                                  role="speech (test), restored quality, 1.2 GB"),
    "libritts_train_clean_100": dict(path="/resources/60/train-clean-100.tar.gz", license="CC BY 4.0",
                                     role="speech (train), original LibriTTS, 24 kHz; resampled to 16 kHz by prepare_data.py"),
    "libritts_dev_clean": dict(path="/resources/60/dev-clean.tar.gz", license="CC BY 4.0",
                               role="speech (val, speakers disjoint from train)"),
    "libritts_test_clean": dict(path="/resources/60/test-clean.tar.gz", license="CC BY 4.0",
                                role="speech (test, speakers disjoint from train and val)"),
    "rirs_noises": dict(path="/resources/28/rirs_noises.zip", license="Apache 2.0 (OpenSLR SLR28)",
                        sha256="3b50cfde915b3984738169b4beb341e9f6b8062ae4c2076146c5db71c2c05dc7",
                        role="room impulse responses + point-source / isotropic noises (16 kHz)",
                        note="real RIRs (RWCP, REVERB 2014, AIR), simulated RIRs, noises from MUSAN; check MUSAN clip licenses"),
}
MANUAL = {
    "vctk": "Download VCTK (CC BY 4.0) from https://datashare.ed.ac.uk/handle/10283/3443 and unzip into datasets/vctk/.",
    "ms_snsd": "git clone https://github.com/microsoft/MS-SNSD datasets/ms_snsd   (verify the noise-file licenses before shipping).",
    "dns_challenge": "https://github.com/microsoft/DNS-Challenge has its own download scripts; verify per-file licenses.",
}


def sha256_of(path, block=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(block):
            h.update(chunk)
    return h.hexdigest()


def urls_for(info):
    """All mirror URLs for a dataset (tests can pass explicit `urls`)."""
    return info.get("urls") or [m + info["path"] for m in MIRRORS]


def aria2_cmd(urls, dest, connections=8, splits=16):
    """aria2c command line: resumable, several connections, and all mirrors at once (it splits the file across them)."""
    dest = pathlib.Path(dest)
    return ["aria2c", "-c", "-x", str(connections), "-s", str(splits), "-k", "4M", "--file-allocation=none",
            "--max-tries=5", "--retry-wait=5", "--console-log-level=warn", "--summary-interval=30",
            "-d", str(dest.parent), "-o", dest.name, *urls]


def download_urllib(urls, dest, retries=3):
    """Resumable single-connection download (HTTP Range), trying each mirror in turn."""
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    for url in urls:
        for attempt in range(retries):
            have = part.stat().st_size if part.exists() else 0
            req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    if have and getattr(r, "status", 206) != 206:  # server ignored Range: start over
                        have = 0
                    with open(part, "ab" if have else "wb") as f:
                        while chunk := r.read(1 << 20):
                            f.write(chunk)
                part.rename(dest)
                return dest
            except Exception as e:  # noqa: BLE001
                print(f"  {url}: attempt {attempt + 1} failed: {e}")
    raise RuntimeError(f"could not download from any mirror: {urls}")


def download(urls, dest, use_aria2=None):
    """Use aria2c when installed (much faster on big files), otherwise the pure-Python downloader."""
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if use_aria2 is None:
        use_aria2 = shutil.which("aria2c") is not None
    if use_aria2:
        r = subprocess.run(aria2_cmd(urls, dest))
        if r.returncode == 0 and dest.exists():
            return dest
        print("  aria2c failed, falling back to the built-in downloader")
    return download_urllib(urls, dest)


def safe_extract(archive, out_dir):
    """Extract tar/zip refusing any member that would land outside out_dir."""
    out = pathlib.Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    def check(name):
        target = (out / name).resolve()
        if out != target and out not in target.parents:
            raise RuntimeError(f"unsafe path in archive: {name}")

    archive = str(archive)
    if archive.endswith((".tar.gz", ".tgz", ".tar")):
        with tarfile.open(archive) as t:
            for m in t.getmembers():
                check(m.name)
                if m.issym() or m.islnk():
                    raise RuntimeError(f"links are not allowed in archives: {m.name}")
            try:
                t.extractall(out, filter="data")
            except TypeError:  # Python < 3.12 without the filter argument
                t.extractall(out)
    elif archive.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for n in z.namelist():
                check(n)
            z.extractall(out)
    else:
        raise ValueError("unknown archive type")


def load_manifest(root):
    p = pathlib.Path(root) / "MANIFEST.json"
    return json.loads(p.read_text()) if p.exists() else {}


def save_manifest(root, m):
    (pathlib.Path(root) / "MANIFEST.json").write_text(json.dumps(m, indent=2, sort_keys=True))


def fetch_one(name, root, delete_archive=False, use_aria2=None, registry=None):
    registry = registry or REGISTRY
    info = registry[name]
    root = pathlib.Path(root)
    urls = urls_for(info)
    archive = root / "_downloads" / pathlib.Path(urls[0]).name
    print(f"{name}: downloading ({len(urls)} mirror(s))")
    download(urls, archive, use_aria2)
    digest = sha256_of(archive)
    if info.get("sha256") and info["sha256"] != digest:
        raise SystemExit(f"{name}: sha256 mismatch\n  expected {info['sha256']}\n  got      {digest}\n"
                         f"The archive may be truncated or changed upstream. Delete {archive} and retry (or try another mirror).")
    manifest = load_manifest(root)
    old = manifest.get(name)
    if old and old["sha256"] != digest:
        raise SystemExit(f"{name}: hash differs from MANIFEST.json ({old['sha256']} vs {digest}); refusing to continue")
    manifest[name] = dict(urls=urls, bytes=archive.stat().st_size, sha256=digest, license=info["license"],
                          date=datetime.date.today().isoformat())
    safe_extract(archive, root / name)
    save_manifest(root, manifest)
    if delete_archive:
        archive.unlink()
    print(f"  ok  sha256 {digest}\n  ledger row: | {name} | {info['license']} | {info.get('role', '')} | {digest} |")
    return digest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "fetch", "verify"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--root", default="datasets")
    ap.add_argument("--delete-archive", action="store_true", help="remove the downloaded archive after extracting (saves disk)")
    ap.add_argument("--no-aria2", action="store_true", help="do not use aria2c even if installed")
    a = ap.parse_args()
    root = pathlib.Path(a.root)
    if a.cmd == "list":
        for k, v in REGISTRY.items():
            print(f"{k:28} {v['license']:28} {v['role']}")
        print("\nmanual:")
        for k, v in MANUAL.items():
            print(f"  {k}: {v}")
        print(f"\naria2c: {'found' if shutil.which('aria2c') else 'not installed (apt-get install aria2 / choco install aria2): downloads will be slower'}")
        return
    if a.cmd == "verify":
        bad = 0
        for k, v in load_manifest(root).items():
            p = root / "_downloads" / pathlib.Path((v.get("urls") or [v.get("url", k)])[0]).name
            if not p.exists():
                print(f"-- {k}: archive was deleted, cannot re-verify")
                continue
            ok = sha256_of(p) == v["sha256"]
            print(f"{'OK ' if ok else 'BAD'} {k}")
            bad += not ok
        raise SystemExit(1 if bad else 0)
    for name in a.names:
        if name not in REGISTRY:
            print(f"unknown dataset {name}; run `list`")
            continue
        fetch_one(name, root, a.delete_archive, use_aria2=False if a.no_aria2 else None)


if __name__ == "__main__":
    main()
