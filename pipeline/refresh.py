#!/usr/bin/env python3
"""Daily refresh: re-fetch catalog data, rebuild the enriched dataset, and stage it into the site.
Safe by design: a download only replaces the previous raw file if it parses as valid data.
Stages the rebuilt sats.json / stats.json / lag.json into site/data/ ready for deployment.
"""
import json, subprocess, sys, shutil, urllib.request, os
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
RAW = str(_ROOT / "data" / "raw")
OUT = str(_ROOT / "data" / "out")
SITE = str(_ROOT / "site" / "data")

FETCHES = [
    ("gp_active.json", "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json", "json"),
    ("gp_cosmos1408.json", "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-1408-debris&FORMAT=json", "json"),
    ("gp_fengyun1c.json", "https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=json", "json"),
    ("gp_iridium33.json", "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=json", "json"),
    ("gp_cosmos2251.json", "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=json", "json"),
    ("satcat.csv", "https://celestrak.org/pub/satcat.csv", "csv"),
    ("psatcat.tsv", "https://planet4589.org/space/gcat/tsv/cat/psatcat.tsv", "tsv"),
]

def valid(path, kind):
    try:
        if kind == "json":
            d = json.load(open(path))
            return isinstance(d, list) and len(d) > 0 and "OBJECT_NAME" in d[0]
        head = open(path, errors="replace").readline()
        if kind == "csv":
            return "NORAD_CAT_ID" in head
        return head.startswith("#JCAT")
    except Exception:
        return False

def main():
    os.makedirs(RAW, exist_ok=True)
    updated, skipped = [], []
    for fname, url, kind in FETCHES:
        tmp = f"{RAW}/.tmp_{fname}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "orbsim-refresh/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as e:
            skipped.append((fname, f"fetch error: {e}")); continue
        if valid(tmp, kind):
            shutil.move(tmp, f"{RAW}/{fname}"); updated.append(fname)
        else:
            # CelesTrak returns a plain-text notice if data hasn't changed in <2h; keep previous file
            note = open(tmp, errors="replace").read(120).replace("\n", " ")
            os.remove(tmp); skipped.append((fname, note))

    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "build_dataset.py")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("BUILD FAILED\n", r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)
    print(r.stdout.strip().splitlines()[-6:])

    for f in ("sats.json", "stats.json", "lag.json"):
        shutil.copy(f"{OUT}/{f}", f"{SITE}/{f}")

    print("updated:", updated)
    print("kept previous (not updated):", skipped)
    print("OK — site/data refreshed")

if __name__ == "__main__":
    main()
