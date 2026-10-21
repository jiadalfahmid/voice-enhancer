"""Compare enhanced clips against their originals and print the metrics table.

  python bench_clips.py --orig original.mp3 --enh enhanced.wav
  python bench_clips.py --dir clips/        # pairs: NAME.<ext> + NAME-enhanced*.wav
  add --json out.json to save results (use this to track models over time)
"""
import argparse
import json
import pathlib

from metrics import compare, load_stereo

FS = 48000


def fmt(v, d=1):
    return "n/a" if v != v else ("-inf" if v == float("-inf") else f"{v:.{d}f}")


def report(name, r):
    o, e = r["orig"], r["enh"]
    print(f"\n== {name}")
    print(f"{'':28}{'original':>12}{'enhanced':>12}")
    for label, key in [("loudness (LUFS)", "lufs"), ("peak (dBFS)", "peak_dbfs"), ("quiet frames p10 (dBFS)", "level_p10_db"),
                       ("median frame (dBFS)", "level_p50_db"), ("loud frames p90 (dBFS)", "level_p90_db"),
                       ("speech-to-floor (dB)", "speech_to_floor_db"), ("30 dB decay (ms, median)", "decay30_ms"),
                       ("decays never reaching 30 dB", "decay30_never_share"), ("side/mid (dB)", "side_to_mid_db")]:
        if key in o:
            print(f"{label:28}{fmt(o[key], 2 if key.endswith('share') else 1):>12}{fmt(e.get(key, float('nan')), 2 if key.endswith('share') else 1):>12}")
    print(f"speech-to-floor improvement (dB, independent of loudness): {fmt(r['speech_to_floor_gain_db'])}")
    print("band change vs overall (dB, loud frames): " + "  ".join(f"{k}:{v:+.1f}" for k, v in r["band_change_db"].items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--orig"); ap.add_argument("--enh"); ap.add_argument("--dir"); ap.add_argument("--json")
    a = ap.parse_args()
    pairs = []
    if a.dir:
        d = pathlib.Path(a.dir)
        for enh in sorted(d.glob("*-enhanced*.wav")):
            stem = enh.name.split("-enhanced")[0]
            orig = next((p for p in d.glob(stem + ".*") if "-enhanced" not in p.name), None)
            if orig:
                pairs.append((stem, orig, enh))
    elif a.orig and a.enh:
        pairs.append((pathlib.Path(a.enh).stem, a.orig, a.enh))
    else:
        ap.error("give --orig and --enh, or --dir")
    out = {}
    for name, o, e in pairs:
        r = compare(load_stereo(o, FS), load_stereo(e, FS), FS)
        out[name] = r
        report(name, r)
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
