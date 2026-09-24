#!/usr/bin/env python3
"""Build the citation manifest (site/data/citation.json) at deploy time.

Single sources of truth — NOTHING in the citation is hardcoded here or in the site:
  * version / date-released  -> CITATION.cff   (build FAILS if absent)
  * version DOI + archived version -> Zenodo API via the concept record
                                      (cached in data/zenodo_cache.json for offline runs)
  * data snapshot date       -> the dataset manifest (data/out/sats.json "generated")

The browser renders the OSCOLA footnote / bibliography forms and BibTeX from this
manifest plus the "generated" field of the dataset it ACTUALLY loaded, and warns
in the Provenance panel if the two disagree.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFF = ROOT / "CITATION.cff"
CACHE = ROOT / "data" / "zenodo_cache.json"
OUT = ROOT / "site" / "data" / "citation.json"
SATS = ROOT / "data" / "out" / "sats.json"
SITE_SATS = ROOT / "site" / "data" / "sats.json"

CONCEPT_RECID = "22662848"  # Zenodo concept record for STARS Observatory (all versions)


def read_cff():
    txt = CFF.read_text(encoding="utf-8")
    ver = re.search(r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?\s*$', txt, re.M)
    rel = re.search(r'^date-released:\s*"?([0-9]{4}-[0-9]{2}-[0-9]{2})"?\s*$', txt, re.M)
    if not ver:
        sys.exit("FATAL: CITATION.cff has no parseable 'version:' — refusing to build a citation.")
    if not rel:
        sys.exit("FATAL: CITATION.cff has no parseable 'date-released:' — refusing to build a citation.")
    return ver.group(1), rel.group(1)


def zenodo_latest():
    """Concept recid -> latest archived version record (version DOI + version label)."""
    url = f"https://zenodo.org/api/records/{CONCEPT_RECID}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "stars-observatory-build/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rec = json.load(r)
        out = {
            "concept_doi": rec.get("conceptdoi") or f"10.5281/zenodo.{CONCEPT_RECID}",
            "version_doi": rec["doi"],
            "version_doi_version": rec.get("metadata", {}).get("version") or "",
            "fetched": datetime.now(timezone.utc).isoformat(),
        }
        if not out["version_doi"]:
            raise ValueError("Zenodo record has no DOI")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(out, indent=2), encoding="utf-8")
        return out, "api"
    except Exception as e:
        if CACHE.exists():
            print(f"WARN: Zenodo API unavailable ({e}); using cached record {CACHE}")
            return json.loads(CACHE.read_text(encoding="utf-8")), "cache"
        sys.exit(f"FATAL: Zenodo API unavailable and no cache present: {e}")


def snapshot_date():
    for p in (SATS, SITE_SATS):
        if p.exists():
            gen = json.load(open(p)).get("generated", "")
            if re.match(r"^\d{4}-\d{2}-\d{2}", gen):
                return gen[:10]
    sys.exit("FATAL: no dataset manifest found (data/out/sats.json or site/data/sats.json) — cannot determine snapshot date.")


def main():
    version, released = read_cff()
    zen, src = zenodo_latest()
    snap = snapshot_date()
    # Never pair "version X" with the DOI of a different archived release. Between
    # bumping CITATION.cff and Zenodo minting the new version's DOI, cite the
    # concept DOI (it always resolves to the latest archived release) instead.
    archived = (zen.get("version_doi_version") or "").lstrip("vV")
    doi = zen["version_doi"]
    if archived != version:
        print(f"WARN: latest Zenodo archive is {archived or 'unknown'}, CITATION.cff says {version}; "
              f"citing the concept DOI {zen['concept_doi']} until {version} is archived")
        doi = zen["concept_doi"]
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "version": version,
        "date_released": released,
        "publisher_year": int(released[:4]),
        "concept_doi": zen["concept_doi"],
        "version_doi": doi,
        "version_doi_version": zen["version_doi_version"],
        "doi_source": src,
        "snapshot_date": snap,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"citation.json: version {version} · snapshot {snap} · "
          f"(latest archive {zen['version_doi_version'] or 'unknown'}) · cited DOI {doi} · concept DOI {zen['concept_doi']} [{src}]")


if __name__ == "__main__":
    main()
