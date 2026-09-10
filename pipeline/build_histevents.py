#!/usr/bin/env python3
"""Build data/histevents.json — archival element sets for case-study replays.

Historical two-line element sets are reconstructed from the US Space
Surveillance Network general-perturbations history (Space-Track), mirrored at
https://huggingface.co/datasets/oxzoid/space-track-tle-history (yearly Parquet).

This is STATIC HISTORICAL DATA: it never changes and is committed to the repo.
Re-run this script only to regenerate or extend the event library.

Validation (run at build time, results embedded in the JSON):
  - Iridium 33 / Cosmos 2251 propagated to 2009-02-10 16:56:00 UTC must pass
    within < 2 km (published: collision; Kelso AAS 09-368 predicted 584 m miss).
  - Fengyun-1C subpoint at 2007-01-11 22:26 UTC must be over central China.
  - Cosmos 1408 subpoint at 2021-11-15 02:47 UTC must be over northern Russia.
"""
import json, math, sys
from datetime import datetime, timezone, timedelta

import duckdb
from sgp4.api import Satrec, jday

UTC = timezone.utc
HF = "https://huggingface.co/datasets/oxzoid/space-track-tle-history/resolve/main/data/tle_%d.parquet"

FETCH = [
    (2007, [25730], "2007-01-08", "2007-01-12"),
    (2009, [24946, 22675], "2009-02-05", "2009-02-11"),
    (2015, [40258, 26824], "2015-06-15", "2015-10-15"),
    (2019, [43600, 44244], "2019-08-22", "2019-09-03"),
    (2021, [13552], "2021-11-08", "2021-11-16"),
]

def fetch_rows():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    rows = {}
    for yr, ids, a, b in FETCH:
        q = (f"SELECT * FROM read_parquet('{HF % yr}') "
             f"WHERE norad_id IN ({','.join(map(str, ids))}) "
             f"AND epoch >= TIMESTAMP '{a}' AND epoch < TIMESTAMP '{b}' "
             f"ORDER BY norad_id, epoch")
        cols = None
        for r in con.execute(q).fetchall():
            if cols is None:
                cols = [d[0] for d in con.description]
            d = dict(zip(cols, r))
            rows.setdefault(d["norad_id"], []).append(d)
        cols = [d[0] for d in con.description]
    return rows

def tle_epoch(dt):
    yy = dt.year % 100
    doy = (dt - datetime(dt.year, 1, 1, tzinfo=UTC)).total_seconds() / 86400.0 + 1
    return f"{yy:02d}{doy:012.8f}"

def fmt_exp(x):
    if not x:
        return " 00000+0"
    s = "-" if x < 0 else " "
    x = abs(x)
    exp = math.floor(math.log10(x)) + 1
    mant = round(x / (10 ** exp) * 100000)
    if mant == 100000:
        mant //= 10
        exp += 1
    return f"{s}{mant:05d}{exp:+d}"

def checksum(l):
    return sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in l) % 10

def make_tle(d):
    dt = d["epoch"].replace(tzinfo=UTC)
    intl = (d["intl_designator"] or "").replace("-", "")
    ndot = d["mean_motion_dot"] or 0.0
    nd = f"{abs(ndot):.8f}"[1:]
    l1 = (f"1 {d['norad_id']:05d}U {intl:<8s} {tle_epoch(dt)} "
          f"{('-' if ndot < 0 else ' ') + nd} {fmt_exp(0)} {fmt_exp(d['bstar'])} 0  999")
    l1 += str(checksum(l1))
    ecc = f"{d['eccentricity']:.7f}"[2:]
    l2 = (f"2 {d['norad_id']:05d} {d['inclination']:8.4f} {d['raan']:8.4f} {ecc} "
          f"{d['arg_perigee']:8.4f} {d['mean_anomaly']:8.4f} {d['mean_motion']:11.8f}99999")
    l2 += str(checksum(l2))
    return l1, l2

def pos(d, when):
    l1, l2 = make_tle(d)
    s = Satrec.twoline2rv(l1, l2)
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute,
                  when.second + when.microsecond / 1e6)
    e, r, _ = s.sgp4(jd, fr)
    return (r, jd + fr) if e == 0 else (None, None)

def bb(rows, nid, when, cut=None):
    lim = min(when, cut) if cut else when
    c = [d for d in rows[nid] if d["epoch"].replace(tzinfo=UTC) <= lim]
    return c[-1] if c else None

def gmst(jd):
    T = (jd - 2451545.0) / 36525.0
    g = (280.46061837 + 360.98564736629 * (jd - 2451545.0)
         + 0.000387933 * T * T - T * T * T / 38710000.0)
    return math.radians(g % 360)

def subpoint(r, jd):
    th = gmst(jd)
    x = r[0] * math.cos(th) + r[1] * math.sin(th)
    y = -r[0] * math.sin(th) + r[1] * math.cos(th)
    return (math.degrees(math.atan2(r[2], math.hypot(r[0], r[1]))),
            math.degrees(math.atan2(y, x)))

def sample(rows, nid, t0, t1, cutoff=None, max_per_day=2.0):
    """Pick a thinned set of elsets covering [t0-1d, t1] for smooth replay."""
    lo = t0 - timedelta(days=1)
    cands = [d for d in rows[nid]
             if lo <= d["epoch"].replace(tzinfo=UTC) <= (cutoff or t1)]
    if not cands:
        return []
    keep, last = [], None
    min_gap = timedelta(hours=24 / max_per_day)
    for d in cands:
        e = d["epoch"].replace(tzinfo=UTC)
        if last is None or e - last >= min_gap:
            keep.append(d)
            last = e
    if cands[-1] is not keep[-1]:
        keep.append(cands[-1])
    return keep

def min_sep(rows, a, b, t0, t1, step_s, cut_a=None, cut_b=None):
    best = (1e12, None)
    t = t0
    step = timedelta(seconds=step_s)
    while t <= t1:
        da, db = bb(rows, a, t, cut_a), bb(rows, b, t, cut_b)
        if da and db:
            ra, _ = pos(da, t)
            rb, _ = pos(db, t)
            if ra and rb:
                d0 = math.dist(ra, rb)
                if d0 < best[0]:
                    best = (d0, t)
        t += step
    return best

def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")

def main():
    rows = fetch_rows()

    # ---- Validation gates -------------------------------------------------
    miss, miss_t = min_sep(rows, 24946, 22675,
                           datetime(2009, 2, 10, 16, 55, 30, tzinfo=UTC),
                           datetime(2009, 2, 10, 16, 56, 30, tzinfo=UTC), 0.1)
    assert miss < 2.0, f"Iridium/Cosmos validation failed: {miss:.2f} km"
    r, jd = pos(bb(rows, 25730, datetime(2007, 1, 11, 22, 26, tzinfo=UTC)),
                datetime(2007, 1, 11, 22, 26, tzinfo=UTC))
    la, lo = subpoint(r, jd)
    assert 20 < la < 45 and 90 < lo < 110, f"Fengyun subpoint off: {la},{lo}"
    r, jd = pos(bb(rows, 13552, datetime(2021, 11, 15, 2, 47, tzinfo=UTC)),
                datetime(2021, 11, 15, 2, 47, tzinfo=UTC))
    la2, lo2 = subpoint(r, jd)
    assert 55 < la2 < 75 and 25 < lo2 < 60, f"Cosmos1408 subpoint off: {la2},{lo2}"

    # Computed geometry (embedded so the site can cite it)
    aeolus_cut = datetime(2019, 9, 2, 9, 0, tzinfo=UTC)
    ae_min = min_sep(rows, 43600, 44244,
                     datetime(2019, 9, 2, 0, 0, tzinfo=UTC),
                     datetime(2019, 9, 3, 0, 0, tzinfo=UTC), 5, cut_a=aeolus_cut)
    lu_coarse = min_sep(rows, 40258, 26824,
                        datetime(2015, 7, 1, tzinfo=UTC),
                        datetime(2015, 10, 14, tzinfo=UTC), 7200)
    lu_min = min_sep(rows, 40258, 26824,
                     lu_coarse[1] - timedelta(days=2),
                     lu_coarse[1] + timedelta(days=2), 300)

    def obj(nid, name, color, t0, t1, cutoff=None, per_day=2.0, fragments=0):
        return {
            "norad": nid, "name": name, "color": color,
            "tles": [list(make_tle(d)) for d in sample(rows, nid, t0, t1, cutoff, per_day)],
            "fragments": fragments,
        }

    ev = {}
    # -- Aeolus / Starlink-44 ----------------------------------------------
    t0 = datetime(2019, 8, 24, 0, 0, tzinfo=UTC)
    t1 = datetime(2019, 9, 2, 11, 10, tzinfo=UTC)
    ev["aeolus"] = {
        "kind": "conjunction",
        "window": [iso(t0), iso(t1)],
        "keyTime": "2019-09-02T11:02:00Z",
        "keyLabel": "Documented closest approach (ESA) — Aeolus had already manoeuvred",
        "slowFinalMin": 90, "durationSec": 40,
        "objects": [
            obj(43600, "Aeolus (ESA)", "#4fd1e0", t0, t1, cutoff=aeolus_cut),
            obj(44244, "Starlink-44 (SpaceX)", "#ff6b6b", t0, t1),
        ],
        "milestones": [
            {"t": "2019-08-24T12:00:00Z", "step": 0},
            {"t": "2019-08-28T12:00:00Z", "step": 1},
            {"t": "2019-08-29T00:00:00Z", "step": 2},
            {"t": "2019-08-30T00:00:00Z", "step": 3},
            {"t": "2019-09-02T10:14:00Z", "step": 4},
        ],
        "note": ("Aeolus is propagated from its last pre-manoeuvre element sets. "
                 "Starlink-44 was actively lowering its orbit on ion thrust, so public "
                 "element sets carry large along-track error for it: the minimum "
                 f"element-set separation on 2 Sep is {ae_min[0]:.0f} km at "
                 f"{ae_min[1].strftime('%H:%M')} UTC, while the actionable P≈1/1,000 "
                 "screening geometry existed only in operator and 18 SPCS "
                 "special-perturbation data. That gap between public and operational "
                 "data is itself part of what this instrument documents."),
    }
    # -- Iridium 33 / Cosmos 2251 -------------------------------------------
    t0 = datetime(2009, 2, 9, 0, 0, tzinfo=UTC)
    t1 = datetime(2009, 2, 11, 4, 0, tzinfo=UTC)   # coda: ~11 h of debris-cloud evolution
    cut = datetime(2009, 2, 10, 16, 56, 0, tzinfo=UTC)
    ev["iridium"] = {
        "kind": "collision",
        "window": [iso(t0), iso(t1)],
        "keyTime": "2009-02-10T16:55:59Z",
        "keyLabel": "Collision — 11.647 km/s, both satellites destroyed",
        "slowFinalMin": 45, "durationSec": 55, "codaFrac": 0.25,
        "objects": [
            obj(24946, "Iridium 33 (US, active)", "#4fd1e0", t0, t1, cutoff=cut, per_day=4, fragments=521),
            obj(22675, "Cosmos 2251 (RU, derelict)", "#ff6b6b", t0, t1, cutoff=cut, per_day=4, fragments=1267),
        ],
        "milestones": [
            {"t": "2009-02-10T15:02:00Z", "step": 2},
            {"t": "2009-02-10T16:55:59Z", "step": 3},
        ],
        "preSteps": [0, 1],
        "note": (f"Propagated from the final published element sets, the two objects "
                 f"pass within {miss*1000:.0f} m of each other at 16:56:00 UTC — "
                 "independent confirmation of the collision geometry from public data "
                 "alone (SOCRATES had predicted a 584 m miss; TLE-space accuracy is "
                 "of km order). The debris cloud is a physically derived visualisation: "
                 "one particle per catalogued fragment (521 from Iridium 33, 1,267 from "
                 "Cosmos 2251), released from the true collision state vector with a "
                 "modelled velocity spread and propagated by two-body dynamics — it "
                 "shows the real mechanics of ring formation, not the catalogued "
                 "fragment orbits themselves."),
    }
    # -- Fengyun-1C ----------------------------------------------------------
    t0 = datetime(2007, 1, 11, 19, 0, tzinfo=UTC)
    t1 = datetime(2007, 1, 12, 8, 0, tzinfo=UTC)   # coda: ~9.5 h of debris-cloud evolution
    cut_fy = datetime(2007, 1, 11, 22, 26, 0, tzinfo=UTC)
    ev["fengyun"] = {
        "kind": "asat",
        "window": [iso(t0), iso(t1)],
        "keyTime": "2007-01-11T22:26:00Z",
        "keyLabel": "Kinetic-kill intercept at ~863 km — no advance notification",
        "slowFinalMin": 30, "durationSec": 50, "codaFrac": 0.25,
        "objects": [obj(25730, "Fengyun-1C (CN, defunct)", "#ffb347", t0, t1, cutoff=cut_fy, per_day=4, fragments=3037)],
        "milestones": [{"t": "2007-01-11T22:26:00Z", "step": 1}],
        "preSteps": [0],
        "note": (f"At the documented intercept time the element sets place Fengyun-1C "
                 f"at {la:.1f}°N {lo:.1f}°E, approaching Xichang's latitude band — the "
                 "ascending pass the SC-19 interceptor met head-on. The interceptor "
                 "itself was never a catalogued object; only the target is replayed. "
                 "The debris cloud is a physically derived visualisation — one particle "
                 "per catalogued fragment (3,037), released from the true intercept "
                 "state vector with a modelled velocity spread and propagated by "
                 "two-body dynamics — not the catalogued fragment orbits themselves."),
    }
    # -- Cosmos 1408 ----------------------------------------------------------
    t0 = datetime(2021, 11, 15, 0, 0, tzinfo=UTC)
    t1 = datetime(2021, 11, 15, 13, 0, tzinfo=UTC)  # coda: ~10 h of debris-cloud evolution
    cut_ck = datetime(2021, 11, 15, 2, 47, 0, tzinfo=UTC)
    ev["cosmos1408"] = {
        "kind": "asat",
        "window": [iso(t0), iso(t1)],
        "keyTime": "2021-11-15T02:47:00Z",
        "keyLabel": "Nudol intercept at ~470 km — ISS crew sheltered",
        "slowFinalMin": 25, "durationSec": 50, "codaFrac": 0.25,
        "objects": [obj(13552, "Cosmos 1408 (RU, defunct)", "#ff6b6b", t0, t1, cutoff=cut_ck, per_day=4, fragments=1604)],
        "milestones": [{"t": "2021-11-15T02:47:00Z", "step": 1}],
        "preSteps": [0],
        "note": (f"At the documented intercept time the element sets place Cosmos 1408 "
                 f"at {la2:.1f}°N {lo2:.1f}°E over northern Russia, downrange of the "
                 "Plesetsk launch site — consistent with the published intercept "
                 "geometry. The interceptor was never a catalogued object. The debris "
                 "cloud is a physically derived visualisation — one particle per "
                 "catalogued fragment (1,604), released from the true intercept state "
                 "vector with a modelled velocity spread and propagated by two-body "
                 "dynamics — not the catalogued fragment orbits themselves."),
    }
    # -- Luch / Olymp ---------------------------------------------------------
    t0 = datetime(2015, 7, 1, 0, 0, tzinfo=UTC)
    t1 = datetime(2015, 10, 14, 0, 0, tzinfo=UTC)
    ev["luch"] = {
        "kind": "rpo",
        "window": [iso(t0), iso(t1)],
        "keyTime": iso(lu_min[1]),
        "keyLabel": f"Minimum element-set separation: {lu_min[0]:.0f} km from Intelsat 901",
        "slowFinalMin": 0, "durationSec": 45,
        "objects": [
            obj(40258, "Luch / Olymp-K (RU)", "#ff6b6b", t0, t1, per_day=0.5),
            obj(26824, "Intelsat 901 (ITSO)", "#4fd1e0", t0, t1, per_day=0.5),
        ],
        "milestones": [{"t": iso(lu_min[1]), "step": 1}],
        "preSteps": [0],
        "note": (f"A 3½-month time-lapse: Luch/Olymp manoeuvres along the GEO ring and "
                 f"holds station alongside Intelsat 901 at 18°W. Element sets bottom out "
                 f"at ≈{lu_min[0]:.0f} km ({lu_min[1].strftime('%d %b %Y')}); operator "
                 "and SSA reporting put the true approaches at ~10 km — GEO element-set "
                 "accuracy is tens of km, so the public data shows the pattern, not the "
                 "precise range."),
    }

    out = {
        "provenance": {
            "source": ("US Space Surveillance Network general-perturbations history "
                       "(Space-Track.org), mirrored dataset: "
                       "huggingface.co/datasets/oxzoid/space-track-tle-history"),
            "method": ("Element records reconstructed to TLE format and propagated "
                       "with SGP4 (satellite.js in-browser; python-sgp4 at build). "
                       "Static historical data, committed; regenerate with "
                       "pipeline/build_histevents.py"),
            "validation": {
                "iridium_cosmos_min_sep_km": round(miss, 3),
                "iridium_cosmos_min_sep_utc": miss_t.strftime("%H:%M:%S.%f")[:-5] + "Z",
                "fengyun_subpoint_at_2226Z": [round(la, 1), round(lo, 1)],
                "cosmos1408_subpoint_at_0247Z": [round(la2, 1), round(lo2, 1)],
                "aeolus_tle_space_min_sep_km_2sep": round(ae_min[0], 1),
                "luch_is901_min_sep_km": round(lu_min[0], 1),
            },
            "built": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "events": ev,
    }
    path = sys.argv[1] if len(sys.argv) > 1 else "site/data/histevents.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    n = sum(len(o["tles"]) for e in ev.values() for o in e["objects"])
    print(f"wrote {path}: {len(ev)} events, {n} element sets")
    print(json.dumps(out["provenance"]["validation"], indent=2))

if __name__ == "__main__":
    main()
