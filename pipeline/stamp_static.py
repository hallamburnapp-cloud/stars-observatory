#!/usr/bin/env python3
"""Write the current snapshot figures, release tag and DOI into site/index.html.

The page fills every [data-stat] / [data-cite] element from the loaded data at
runtime; this build step writes the same values into the static HTML so that
first paint (and a visit with JavaScript disabled) never shows a stale date,
count or "DOI: —". Values are computed exactly as fillStats() in site/js/app.js.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


def fmt(n):
    return f"{n:,}"


def main():
    stats = json.loads((SITE / "data" / "stats.json").read_text())
    sats = json.loads((SITE / "data" / "sats.json").read_text())
    cit = json.loads((SITE / "data" / "citation.json").read_text())
    pay_total = stats.get("by_type", {}).get("PAY", 0)
    us_pay = stats.get("by_owner_payloads", {}).get("US", 0)
    starlink = sum(v for k, v in stats.get("constellations", {}).items() if k.startswith("Starlink"))
    regd = sum(v[0] for v in stats.get("registration_by_owner", {}).values())
    unreg = sum(v[1] for v in stats.get("registration_by_owner", {}).values())
    total = stats.get("total_onorbit", 0)
    n = len(sats["sats"])
    vals = {
        "date": sats["generated"][:10],
        "totalOnorbit": fmt(total), "propagated": fmt(n), "noGP": fmt(total - n),
        "payTotal": fmt(pay_total), "usPay": fmt(us_pay),
        "usPct": str(round(us_pay / pay_total * 100)) if pay_total else "0",
        "starlink": fmt(starlink), "unreg": fmt(unreg),
        "unregPct": str(round(unreg / (regd + unreg) * 100)) if (regd + unreg) else "0",
    }
    cites = {"doi": cit.get("version_doi", ""), "release": cit.get("release_tag", "")}
    from datetime import date
    lag = json.loads((SITE / "data" / "lag.json").read_text())
    r = lambda n: "—" if n is None else fmt(round(n))
    q = lag.get("lag_quartiles_days") or [None, None]
    st = lag.get("started")
    lagv = {"n": r(lag.get("flips_observed")), "median": r(lag.get("median_lag_days")), "q1": r(q[0]), "q3": r(q[1]),
            "max": r(lag.get("max_lag_days")),
            "started": date.fromisoformat(st).strftime("%-d %B %Y") if st else "—"}
    idx = SITE / "index.html"
    html = idx.read_text()
    out = re.sub(r'(<(span|div)\b[^>]*\bdata-stat="([A-Za-z]+)"[^>]*>)[^<]*(</\2>)',
                 lambda m: m.group(1) + vals[m.group(3)] + m.group(4) if m.group(3) in vals else m.group(0), html)
    out = re.sub(r'(<(span|div)\b[^>]*\bdata-cite="([a-z]+)"[^>]*>)[^<]*(</\2>)',
                 lambda m: m.group(1) + (cites.get(m.group(3)) or '—') + m.group(4), out)
    out = re.sub(r'(<span data-lag="([a-z0-9]+)">)[^<]*(</span>)',
                 lambda m: m.group(1) + lagv.get(m.group(2), '—') + m.group(3), out)
    if cites["doi"]:
        out = re.sub(r'(<a data-cite-href="doi" href=")[^"]*(")', r'\g<1>https://doi.org/' + cites["doi"] + r'\2', out)
    left = sorted(set(re.findall(r'data-stat="([A-Za-z]+)"[^>]*>—<', out)))
    if left:
        sys.exit(f"stamp_static: no value for data-stat {left}")
    if out != html:
        idx.write_text(out)
    print(f"stamped static HTML: snapshot {vals['date']}, release {cites['release'] or '—'}, DOI {cites['doi'] or '—'}")


if __name__ == "__main__":
    main()
