#!/usr/bin/env python3
"""Refresh and stage the site's data.

Two modes:
  --mode fetch    (the daily 06:00 UTC schedule only) downloads every CelesTrak
                  and GCAT source once, rebuilds the enriched dataset and the
                  registration-lag ledger, and stages them into site/data/.
                  Any failed download, non-200 response or invalid file halts
                  the run with a logged error: nothing new is staged or
                  published, and the site keeps its previous snapshot and date.
  --mode rebuild  (every push and manual run) contacts no data source. It takes
                  the currently published snapshot from the live site and
                  re-stages it unchanged, so a code deploy never alters a
                  snapshot or gives it a date its data does not have.
"""
import argparse, json, re, subprocess, sys, shutil, urllib.request, urllib.error, os
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
LIVE = "https://starsobservatory.org/data"
PUBLISHED = ("sats.json", "stats.json", "lag.json")


def die(msg):
    print(f"HALT: {msg}")
    print("Nothing new was staged; the site keeps its previous snapshot and date.")
    sys.exit(1)


def download(url, dst):
    """Download url to dst. Any error or non-200 status raises."""
    req = urllib.request.Request(url, headers={"User-Agent": "stars-observatory-refresh/2.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        if r.status != 200:
            raise urllib.error.HTTPError(url, r.status, f"HTTP {r.status}", r.headers, None)
        with open(dst, "wb") as f:
            shutil.copyfileobj(r, f)


def normalise_lag(path):
    """Rename the legacy ledger key (v1.8.0) in a lag.json published before the rename."""
    d = json.load(open(path))
    if "watching_unregistered" in d and "watching_no_un_match" not in d:
        d["watching_no_un_match"] = d.pop("watching_unregistered")
        json.dump(d, open(path, "w"), separators=(",", ":"))

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

def fetch_sources():
    """Download every source once; halt on the first failure."""
    os.makedirs(RAW, exist_ok=True)
    for fname, url, kind in FETCHES:
        tmp = f"{RAW}/.tmp_{fname}"
        try:
            download(url, tmp)
        except Exception as e:
            if os.path.exists(tmp): os.remove(tmp)
            die(f"DOWNLOAD FAILED {fname} <{url}>: {e}")
        if not valid(tmp, kind):
            note = open(tmp, errors="replace").read(160).replace("\n", " ")
            os.remove(tmp)
            die(f"INVALID SOURCE {fname} <{url}>: not {kind} catalogue data — {note!r}")
        shutil.move(tmp, f"{RAW}/{fname}")
        print(f"downloaded {fname}")

    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "build_dataset.py")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:]); die("BUILD FAILED")
    print(r.stdout.strip().splitlines()[-6:])
    for f in PUBLISHED:
        shutil.copy(f"{OUT}/{f}", f"{SITE}/{f}")


def restage_published():
    """Re-stage the snapshot the site currently publishes, unchanged."""
    for f in PUBLISHED:
        tmp = f"{SITE}/.tmp_{f}"
        try:
            download(f"{LIVE}/{f}", tmp)
            json.load(open(tmp))
        except Exception as e:
            if os.path.exists(tmp): os.remove(tmp)
            die(f"could not read the published snapshot {LIVE}/{f}: {e}")
        shutil.move(tmp, f"{SITE}/{f}")
    normalise_lag(f"{SITE}/lag.json")
    gen = json.load(open(f"{SITE}/sats.json")).get("generated", "")
    print(f"re-staged the published snapshot of {gen[:10]} (no data source contacted)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("fetch", "rebuild"), required=True)
    mode = ap.parse_args().mode
    if mode == "fetch":
        fetch_sources()
    else:
        restage_published()

    # Lossless compact transport copy of sats.json for the app's first load.
    # pack_sats.py verifies the round trip and hard-fails on any mismatch.
    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "pack_sats.py"), SITE],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("PACK FAILED\n", r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)

    # Staleness guard: if CelesTrak keeps serving old element sets the median
    # element-set epoch drifts back in time. Healthy data sits at ~0.5 days; fail loudly past
    # STALE_DAYS so the deploy stops and the failure alert fires, instead of
    # publishing yesterday's sky under today's date.
    if mode == "fetch":
        median_age = median_epoch_age_days(f"{SITE}/sats.json")
        print(f"median element-set epoch age: {median_age:.2f} days")
        if median_age > STALE_DAYS:
            die(f"STALE SOURCE DATA: median epoch age {median_age:.1f} d > {STALE_DAYS} d")

    # Regenerate the citation manifest (version from CITATION.cff, DOI from Zenodo,
    # snapshot date from the dataset manifest). Hard-fails the refresh if the
    # citation cannot be built truthfully — a deploy without a correct citation
    # is worse than no deploy.
    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "build_citation.py")],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("CITATION BUILD FAILED\n", r.stderr[-2000:]); sys.exit(1)

    # Write the current snapshot figures, release tag and DOI into the static
    # HTML, so first paint and no-JavaScript visits never show stale values.
    r = subprocess.run([sys.executable, str(_ROOT / "pipeline" / "stamp_static.py")],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print("STATIC STAMP FAILED\n", r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)

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

    print("OK — site/data refreshed")

if __name__ == "__main__":
    main()
