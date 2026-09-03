#!/usr/bin/env python3
"""Fuse CelesTrak GP/SATCAT + GCAT psatcat into enriched dataset with legal overlays."""
import json, csv, re, html
from collections import defaultdict
from datetime import datetime

from pathlib import Path
_ROOT = Path(__file__).resolve().parents[1]
RAW = str(_ROOT / "data" / "raw")
OUT = str(_ROOT / "data" / "out")
import os; os.makedirs(OUT, exist_ok=True)

# ---------- TLE synthesis from GP JSON ----------
def tle_checksum(line):
    s = 0
    for c in line:
        if c.isdigit(): s += int(c)
        elif c == '-': s += 1
    return s % 10

def fmt_exp(v):
    """TLE 8-char exponent field e.g. 0.00040013413 -> ' 40013-3'"""
    if v == 0: return " 00000+0"
    sign = '-' if v < 0 else ' '
    v = abs(v)
    exp = 0
    # normalize to 0.NNNNN form
    while v >= 1: v /= 10; exp += 1
    while v < 0.1: v *= 10; exp -= 1
    mant = round(v * 100000)
    if mant == 100000: mant = 10000; exp += 1
    esign = '+' if exp >= 0 else '-'
    return f"{sign}{mant:05d}{esign}{abs(exp)}"

def fmt_mmdot(v):
    sign = '-' if v < 0 else ' '
    s = f"{abs(v):.8f}"[1:]  # strip leading 0 -> .NNNNNNNN
    return f"{sign}{s}"

def gp_to_tle(o):
    norad = o["NORAD_CAT_ID"]
    intl = o.get("OBJECT_ID") or ""
    m = re.match(r"(\d{4})-(\w+)", intl)
    intl_tle = (m.group(1)[2:] + m.group(2)) if m else ""
    ep = datetime.fromisoformat(o["EPOCH"])
    yday = ep.timetuple().tm_yday
    frac = (ep.hour*3600 + ep.minute*60 + ep.second + ep.microsecond/1e6) / 86400.0
    epoch_str = f"{ep.year % 100:02d}{yday:03d}.{frac:.8f}".replace("0.", "", 1) if False else f"{ep.year % 100:02d}{yday+frac:012.8f}"
    l1 = (f"1 {norad:05d}U {intl_tle:<8} {epoch_str} {fmt_mmdot(o.get('MEAN_MOTION_DOT',0))} "
          f"{fmt_exp(o.get('MEAN_MOTION_DDOT',0))} {fmt_exp(o.get('BSTAR',0))} 0 {o.get('ELEMENT_SET_NO',999):4d}")
    l1 += str(tle_checksum(l1))
    ecc = f"{o['ECCENTRICITY']:.7f}"[2:]
    l2 = (f"2 {norad:05d} {o['INCLINATION']:8.4f} {o['RA_OF_ASC_NODE']:8.4f} {ecc} "
          f"{o['ARG_OF_PERICENTER']:8.4f} {o['MEAN_ANOMALY']:8.4f} {o['MEAN_MOTION']:11.8f}{o.get('REV_AT_EPOCH',0):5d}")
    l2 += str(tle_checksum(l2))
    return l1, l2

# ---------- validation against real TLE (dev-time check; skipped if reference file absent) ----------
def validate():
    if not os.path.exists(f"{RAW}/tle_cosmos2251.txt"):
        print("validate: skipped (no reference TLE file)")
        return
    gp = json.load(open(f"{RAW}/gp_cosmos2251.json"))
    real = {}
    lines = open(f"{RAW}/tle_cosmos2251.txt").read().splitlines()
    for i in range(0, len(lines)-2, 3):
        norad = int(lines[i+1][2:7])
        real[norad] = (lines[i+1].rstrip(), lines[i+2].rstrip())
    ok, bad = 0, 0
    for o in gp[:50]:
        n = o["NORAD_CAT_ID"]
        if n not in real: continue
        g1, g2 = gp_to_tle(o)
        r1, r2 = real[n]
        if g1 == r1 and g2 == r2: ok += 1
        else:
            bad += 1
            if bad <= 2:
                print("GEN1:", g1); print("REA1:", r1); print("GEN2:", g2); print("REA2:", r2)
    print(f"validate: {ok} exact, {bad} mismatched")

validate()

# ---------- SATCAT ----------
satcat = {}
for row in csv.DictReader(open(f"{RAW}/satcat.csv")):
    satcat[int(row["NORAD_CAT_ID"])] = row

# ---------- owner code -> name from sources.html ----------
src = open(_ROOT / "data" / "sources.html").read()
owner_names = {}
for m in re.finditer(r">([A-Z-]{2,6})</td><td[^>]*>([^<]+)</td>", src):
    owner_names[m.group(1)] = html.unescape(m.group(2)).strip()
# Canonical SATCAT owner codes (standard 18 SDS designators)
owner_names.update({
    "US": "United States", "CIS": "Russia (CIS)", "PRC": "China", "UK": "United Kingdom",
    "JPN": "Japan", "FR": "France", "GER": "Germany", "IND": "India", "IT": "Italy",
    "CA": "Canada", "AUS": "Australia", "BRAZ": "Brazil", "SKOR": "South Korea",
    "NKOR": "North Korea", "TWN": "Taiwan", "ISRA": "Israel", "SPN": "Spain",
    "NETH": "Netherlands", "SWTZ": "Switzerland", "SWED": "Sweden", "NOR": "Norway",
    "DEN": "Denmark", "FIN": "Finland", "POL": "Poland", "CZCH": "Czech Republic",
    "CHLE": "Chile", "MEX": "Mexico", "UAE": "United Arab Emirates", "SAUD": "Saudi Arabia",
    "TURK": "Turkey", "IRAN": "Iran", "PAKI": "Pakistan", "INDO": "Indonesia",
    "THAI": "Thailand", "MALA": "Malaysia", "SING": "Singapore", "VTNM": "Vietnam",
    "EGYP": "Egypt", "NIG": "Nigeria", "SAFR": "South Africa", "KAZ": "Kazakhstan",
    "UKR": "Ukraine", "BELA": "Belarus", "AZER": "Azerbaijan", "LUXE": "Luxembourg",
    "BEL": "Belgium", "AUST": "Austria", "POR": "Portugal", "GREC": "Greece",
    "HUN": "Hungary", "IRE": "Ireland", "NZ": "New Zealand", "ARGN": "Argentina",
    "ESA": "European Space Agency", "EUME": "EUMETSAT", "EUTE": "Eutelsat",
    "ITSO": "Intelsat (ITSO)", "IM": "Inmarsat", "SES": "SES (Luxembourg)",
    "O3B": "O3b Networks", "AB": "Arab Satellite Comm. Org.", "ABS": "ABS (Asia Broadcast)",
    "AC": "Asia Satellite Telecom", "GLOB": "Globalstar", "IRID": "Iridium", "ORB": "Orbcomm",
    "RASC": "RascomStar-QAF", "EST": "Estonia", "LTU": "Lithuania", "LVA": "Latvia",
    "BGR": "Bulgaria", "ROM": "Romania", "SVK": "Slovakia", "SLO": "Slovenia",
    "QAT": "Qatar", "KWT": "Kuwait", "BHR": "Bahrain", "JOR": "Jordan", "MORO": "Morocco",
    "ALG": "Algeria", "TUN": "Tunisia", "KEN": "Kenya", "ETH": "Ethiopia", "ANG": "Angola",
    "BOL": "Bolivia", "VENZ": "Venezuela", "PER": "Peru", "COL": "Colombia", "ECU": "Ecuador",
    "URY": "Uruguay", "PRY": "Paraguay", "CRI": "Costa Rica", "BGD": "Bangladesh",
    "LKA": "Sri Lanka", "NPL": "Nepal", "MNG": "Mongolia", "MMR": "Myanmar", "KHM": "Cambodia",
    "LAOS": "Laos", "PHL": "Philippines", "BRUN": "Brunei", "TBD": "To Be Determined / Unattributed",
})

# ---------- GCAT psatcat: UN registration ----------
unreg = {}   # norad -> (registered bool, unstate)
f = open(f"{RAW}/psatcat.tsv", encoding="utf-8", errors="replace")
header = f.readline().lstrip("#").rstrip("\n").split("\t")
idx = {k: i for i, k in enumerate(header)}
for line in f:
    if line.startswith("#"): continue
    p = line.rstrip("\n").split("\t")
    if len(p) < len(header): continue
    jcat = p[idx["JCAT"]].strip()
    if not jcat.startswith("S"): continue
    try: norad = int(jcat[1:])
    except ValueError: continue
    reg = p[idx["UNReg"]].strip()
    unstate = p[idx["UNState"]].strip()
    unreg[norad] = (reg not in ("", "-"), unstate)

# ---------- constellation tagging ----------
CONSTELLATIONS = [
    ("STARLINK", "Starlink (SpaceX, US)"),
    ("ONEWEB", "OneWeb (Eutelsat, UK)"),
    ("QIANFAN", "Qianfan/G60 (China)"),
    ("SQX", None), ("GUOWANG", "Guowang (China)"), ("HULIANWANG", "Guowang (China)"),
    ("KUIPER", "Kuiper (Amazon, US)"),
    ("IRIDIUM", "Iridium NEXT (US)"),
    ("GLOBALSTAR", "Globalstar (US)"),
    ("FLOCK", "Planet Flock (US)"),
    ("LEMUR", "Spire Lemur (US)"),
    ("YINHE", "Galaxy Space (China)"),
    ("KINEIS", "Kineis (France)"),
]
def constellation(name):
    u = name.upper()
    for pre, label in CONSTELLATIONS:
        if label and u.startswith(pre): return label
    return ""

# ---------- build per-object records ----------
groups = ["gp_active.json", "gp_cosmos1408.json", "gp_fengyun1c.json", "gp_iridium33.json", "gp_cosmos2251.json"]
seen = set()
owners_list, const_list = [], []
owner_idx, const_idx = {}, {}
def oi(code):
    if code not in owner_idx:
        owner_idx[code] = len(owners_list)
        owners_list.append([code, owner_names.get(code, code)])
    return owner_idx[code]
def ci(label):
    if label not in const_idx:
        const_idx[label] = len(const_list)
        const_list.append(label)
    return const_idx[label]

records = []
for gfile in groups:
    for o in json.load(open(f"{RAW}/{gfile}")):
        n = o["NORAD_CAT_ID"]
        if n in seen: continue
        seen.add(n)
        try: l1, l2 = gp_to_tle(o)
        except Exception: continue
        sc = satcat.get(n, {})
        otype = sc.get("OBJECT_TYPE", "UNK")  # PAY, R/B, DEB, UNK
        owner = sc.get("OWNER", "TBD")
        reg, unstate = unreg.get(n, (False, ""))
        name = o.get("OBJECT_NAME", str(n))
        records.append([n, name, l1, l2, otype, oi(owner), ci(constellation(name)), 1 if reg else 0, sc.get("LAUNCH_DATE","")[:4]])

json.dump({"generated": datetime.utcnow().isoformat()+"Z",
           "owners": owners_list, "constellations": const_list, "sats": records},
          open(f"{OUT}/sats.json","w"), separators=(",",":"))
print(f"records: {len(records)}, owners: {len(owners_list)}, constellations: {len(const_list)}")

# ---------- full-catalog stats (all on-orbit objects incl. those without GP) ----------
onorbit = [r for r in satcat.values() if not r["DECAY_DATE"] and r["ORBIT_CENTER"] == "EA"]
stats = {"generated": datetime.utcnow().isoformat()+"Z", "total_onorbit": len(onorbit)}
by = lambda key: defaultdict(int)
type_c, owner_c, owner_pay, owner_active = by(1), by(1), by(1), by(1)
reg_by_owner = defaultdict(lambda: [0,0])   # owner -> [registered, unregistered] payloads on orbit
reg_by_year = defaultdict(lambda: [0,0])
const_c = defaultdict(int)
active_codes = ("+","P","B","S","X")  # OPS status considered operational-ish; '+' active, 'P' partial
for r in onorbit:
    n = int(r["NORAD_CAT_ID"])
    t = r["OBJECT_TYPE"] or "UNK"
    ow = r["OWNER"] or "TBD"
    type_c[t] += 1; owner_c[ow] += 1
    if t == "PAY":
        owner_pay[ow] += 1
        if (r["OPS_STATUS_CODE"] or "") in ("+","P"): owner_active[ow] += 1
        regd, _ = unreg.get(n, (False, ""))
        reg_by_owner[ow][0 if regd else 1] += 1
        y = (r["LAUNCH_DATE"] or "")[:4]
        if y: reg_by_year[y][0 if regd else 1] += 1
        cl = constellation(r["OBJECT_NAME"] or "")
        if cl: const_c[cl] += 1
stats["by_type"] = dict(type_c)
stats["owner_names"] = {k: owner_names.get(k, k) for k in owner_c}
stats["by_owner_all"] = dict(sorted(owner_c.items(), key=lambda x:-x[1]))
stats["by_owner_payloads"] = dict(sorted(owner_pay.items(), key=lambda x:-x[1]))
stats["by_owner_active"] = dict(sorted(owner_active.items(), key=lambda x:-x[1]))
stats["registration_by_owner"] = {k: v for k, v in sorted(reg_by_owner.items(), key=lambda x:-(x[1][0]+x[1][1]))}
stats["registration_by_year"] = dict(sorted(reg_by_year.items()))
stats["constellations"] = dict(sorted(const_c.items(), key=lambda x:-x[1]))
json.dump(stats, open(f"{OUT}/stats.json","w"), separators=(",",":"))
print("stats: total on-orbit", len(onorbit))
print("types:", dict(type_c))
top = list(stats["by_owner_payloads"].items())[:8]
print("top payload owners:", top)
regtot = [0,0]
for v in reg_by_owner.values(): regtot[0]+=v[0]; regtot[1]+=v[1]
print("payloads on orbit registered/unregistered:", regtot)

# ---------- Registration Lag Ledger ----------
# Tracks, day by day, when each on-orbit payload first appears in the catalog and
# when its UN registration first becomes visible in GCAT. Payloads already
# registered at seeding cannot yield a lag (their registration date is unknown);
# lag is measured only for payloads observed to FLIP from unregistered to
# registered after the ledger started. This accrues an original longitudinal
# dataset: per-State registration latency distributions.
LEDGER = str(_ROOT / "data" / "ledger.json")
today = datetime.utcnow().strftime("%Y-%m-%d")
try:
    ledger = json.load(open(LEDGER))
except Exception:
    ledger = {"started": today, "payloads": {}}
lp = ledger["payloads"]
flips_today = 0
for r in onorbit:
    if (r["OBJECT_TYPE"] or "") != "PAY": continue
    n = str(int(r["NORAD_CAT_ID"]))
    regd, _ = unreg.get(int(n), (False, ""))
    if n not in lp:
        lp[n] = {"l": r["LAUNCH_DATE"] or "", "o": r["OWNER"] or "TBD",
                 "nm": r["OBJECT_NAME"] or n, "fs": today,
                 "r": 1 if regd else 0, "fd": None}
    else:
        e = lp[n]
        if e["r"] == 0 and regd:
            e["r"] = 1; e["fd"] = today; flips_today += 1
        elif e["r"] == 1 and not regd:
            pass  # GCAT correction/noise: keep first observation, do not un-register
ledger["updated"] = today
json.dump(ledger, open(LEDGER, "w"), separators=(",",":"))

# summary for the site
flips = []
for n, e in lp.items():
    if e.get("fd") and e.get("l"):
        try:
            lag = (datetime.strptime(e["fd"], "%Y-%m-%d") - datetime.strptime(e["l"], "%Y-%m-%d")).days
        except ValueError:
            continue
        flips.append({"norad": int(n), "name": e["nm"], "owner": e["o"],
                      "launch": e["l"], "registered_on": e["fd"], "lag_days": lag})
flips.sort(key=lambda x: x["registered_on"], reverse=True)
by_owner_lag = defaultdict(list)
for fpl in flips: by_owner_lag[fpl["owner"]].append(fpl["lag_days"])
def median(xs):
    xs = sorted(xs); m = len(xs)//2
    return xs[m] if len(xs) % 2 else (xs[m-1]+xs[m])/2
watching = sum(1 for e in lp.values() if e["r"] == 0)
lag_out = {
    "started": ledger["started"], "updated": today,
    "days_running": (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(ledger["started"], "%Y-%m-%d")).days + 1,
    "tracked_payloads": len(lp), "watching_unregistered": watching,
    "flips_observed": len(flips), "flips_today": flips_today,
    "recent_flips": flips[:200],
    "lag_by_owner": {o: {"flips": len(v), "median_lag_days": median(v)} for o, v in sorted(by_owner_lag.items(), key=lambda x: -len(x[1]))},
    "median_lag_days": median([fpl["lag_days"] for fpl in flips]) if flips else None
}
json.dump(lag_out, open(f"{OUT}/lag.json", "w"), separators=(",",":"))
print(f"ledger: {len(lp)} payloads tracked, watching {watching} unregistered, {len(flips)} flips observed")
