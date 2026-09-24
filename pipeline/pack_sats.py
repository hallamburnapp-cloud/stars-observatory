#!/usr/bin/env python3
"""Write site/data/sats.pack.json — a lossless, compression-friendly packing of
sats.json for the web app's first load.

sats.json stays the canonical, archived dataset (stars-observatory-data pulls
it daily as the citable snapshot); this file is only a transport encoding of
exactly the same records. Row-wise TLE strings interleave unrelated fields, so
gzip sees little repetition. Here every TLE field is stored as its own column
(all epochs together, all inclinations together, ...), which gzip compresses
~30% better. The TLE line checksum is dropped and recomputed on load.

The build refuses to write the pack unless unpack(pack) reproduces every
sats.json record exactly (the same check runs in the browser QA gate).

Usage: python pipeline/pack_sats.py [site/data]
"""
import json, sys
from pathlib import Path

FORMAT = 1
# Fixed-width column boundaries after the catalogue number, as offsets from
# the end of the line (so 5- and 6-digit catalogue numbers share one layout).
# Line 1: class+intl-des | epoch | ndot+nddot | bstar+ephtype+elset   (checksum dropped)
# Line 2: incl | raan | ecc | argp | M | mean motion | rev number   (checksum dropped)
L1 = [62, 51, 36, 16, 1]
L2 = [62, 52, 43, 35, 26, 17, 6, 1]
TYPES = {"PAY": "P", "DEB": "D", "R/B": "R", "UNK": "U"}


def checksum(line68):
    return str(sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in line68) % 10)


def split(line, bounds):
    n = len(line)
    return [line[n - a:n - b] for a, b in zip(bounds, bounds[1:])]


def pack(d):
    S = d["sats"]
    cols1 = [[] for _ in L1[1:]]
    cols2 = [[] for _ in L2[1:]]
    satw = []          # catalogue-number width per record (5 unless 6-digit)
    raw = {}           # records whose lines don't fit the layout: kept verbatim
    prev = 0
    norad_d = []
    for i, s in enumerate(S):
        norad, name, l1, l2 = s[0], s[1], s[2], s[3]
        norad_d.append(norad - prev); prev = norad
        w = len(l1) - 64
        sat = str(norad).zfill(5)
        ok = (len(l1) == len(l2) and w >= 5 and l1[:2] == "1 " and l2[:2] == "2 "
              and l1[2:2 + w] == sat and l2[2:2 + w] == sat
              and l1[-1] == checksum(l1[:-1]) and l2[-1] == checksum(l2[:-1]))
        if not ok:
            raw[str(i)] = [l1, l2]
            l1 = l2 = "0" * 69  # placeholder keeps the columns aligned
            w = 5
        satw.append(str(w))
        for c, v in zip(cols1, split(l1, L1)): c.append(v)
        for c, v in zip(cols2, split(l2, L2)): c.append(v)
    years = [s[8] if len(s[8]) == 4 else "    " for s in S]
    for i, s in enumerate(S):
        if len(s[8]) not in (0, 4) or s[4] not in TYPES:
            raise SystemExit(f"pack: unsupported field in record {i}: {s[4]!r} {s[8]!r}")
    return {
        "format": FORMAT,
        "generated": d["generated"], "owners": d["owners"], "constellations": d["constellations"],
        "n": len(S),
        "noradDelta": norad_d,
        "name": [s[1] for s in S],
        "type": "".join(TYPES[s[4]] for s in S),
        "owner": [s[5] for s in S],
        "const": [s[6] for s in S],
        "reg": "".join(str(s[7]) for s in S),
        "year": "".join(years),
        "satw": "".join(satw),
        "l1": ["".join(c) for c in cols1],
        "l2": ["".join(c) for c in cols2],
        "raw": raw,
    }


def unpack(p):
    """Reference decoder — mirrors unpackSats() in site/js/app.js."""
    inv = {v: k for k, v in TYPES.items()}
    n = p["n"]
    w1 = [a - b for a, b in zip(L1, L1[1:])]
    w2 = [a - b for a, b in zip(L2, L2[1:])]
    out, norad = [], 0
    for i in range(n):
        norad += p["noradDelta"][i]
        if str(i) in p["raw"]:
            l1, l2 = p["raw"][str(i)]
        else:
            sat = str(norad).zfill(int(p["satw"][i]))
            t1 = "".join(col[i * w:(i + 1) * w] for col, w in zip(p["l1"], w1))
            t2 = "".join(col[i * w:(i + 1) * w] for col, w in zip(p["l2"], w2))
            l1 = "1 " + sat + t1; l1 += checksum(l1)
            l2 = "2 " + sat + t2; l2 += checksum(l2)
        y = p["year"][i * 4:(i + 1) * 4]
        out.append([norad, p["name"][i], l1, l2, inv[p["type"][i]], p["owner"][i], p["const"][i],
                    int(p["reg"][i]), y if y != "    " else ""])
    return out


def main():
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "site" / "data")
    d = json.loads((data_dir / "sats.json").read_text())
    p = pack(d)
    if unpack(p) != d["sats"]:
        raise SystemExit("pack: round-trip mismatch — refusing to write sats.pack.json")
    (data_dir / "sats.pack.json").write_text(json.dumps(p, separators=(",", ":")))
    print(f"sats.pack.json: {p['n']} records, {len(p['raw'])} kept verbatim, round-trip exact")


if __name__ == "__main__":
    main()
