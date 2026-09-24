#!/usr/bin/env python3
"""Daily refresh: re-fetch catalog data, rebuild the enriched dataset, and stage it into the site.
Safe by design: a download only replaces the previous raw file if it parses as valid data.
Stages the rebuilt sats.json / stats.json / lag.json into site/data/ ready for deployment.
"""
import json, re, subprocess, sys, shutil, urllib.request, os
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

STALE_DAYS = 3.0

def median_epoch_age_days(sats_path):
    from datetime import datetime, timedelta, timezone
    from statistics import median
    now = datetime.now(timezone.utc)
    ages = []
    for rec in json.load(open(sats_path))["sats"]:
        l1 = rec[2]
        e = l1[len(l1) - 51:len(l1) - 37]  # epoch YYDDD.DDDDDDDD (end-relative: 5/6-digit catnums)
        yy, doy = int(e[:2]), float(e[2:])
        t = datetime(2000 + yy if yy < 57 else 1900 + yy, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1)
        ages.append((now - t).total_seconds() / 86400)
    return median(ages)

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

    # Lossless compact transport copy of sats.json for the app's first load.
    # pack_sats.py verifies the round trip and hard-fails on any mismatch.
    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "pack_sats.py"), SITE],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("PACK FAILED\n", r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)

    # Staleness guard: if CelesTrak keeps serving old element sets (or a fetch
    # silently fell back to a previous file) the median element-set epoch
    # drifts back in time. Healthy data sits at ~0.5 days; fail loudly past
    # STALE_DAYS so the deploy stops and the failure alert fires, instead of
    # publishing yesterday's sky under today's date.
    median_age = median_epoch_age_days(f"{SITE}/sats.json")
    print(f"median element-set epoch age: {median_age:.2f} days")
    if median_age > STALE_DAYS:
        print(f"STALE SOURCE DATA: median epoch age {median_age:.1f} d > {STALE_DAYS} d"); sys.exit(1)

    # Regenerate the citation manifest (version from CITATION.cff, DOI from Zenodo,
    # snapshot date from the dataset manifest). Hard-fails the refresh if the
    # citation cannot be built truthfully — a deploy without a correct citation
    # is worse than no deploy.
    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "build_citation.py")],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("CITATION BUILD FAILED\n", r.stderr[-2000:]); sys.exit(1)

    # Stamp asset cache-busters from the single version source (CITATION.cff).
    # Idempotent: only rewrites ?v=... tokens; a stale literal version anywhere
    # in index.html is treated as a bug and overwritten.
    ver = re.search(r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?\s*$',
                    (_ROOT / "CITATION.cff").read_text(), re.M)
    if not ver:
        print("CITATION.cff has no version — refusing to stamp assets"); sys.exit(1)
    idx = _ROOT / "site" / "index.html"
    html = idx.read_text()
    stamped = re.sub(r'\?v=[0-9A-Za-z.\-]+', f'?v={ver.group(1)}', html)
    if stamped != html:
        idx.write_text(stamped); print(f"stamped asset versions -> ?v={ver.group(1)}")

    print("updated:", updated)
    print("kept previous (not updated):", skipped)
    print("OK — site/data refreshed")

if __name__ == "__main__":
    main()
