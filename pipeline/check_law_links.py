#!/usr/bin/env python3
"""Check that every national space-law source link in site/data/national_law.json
still loads. Content is maintained by hand; this only catches links that break.

Entries marked source_check == "blocked-but-canonical" are official pages that
refuse automated requests (403/405, JavaScript-only pages, incomplete TLS chains
that browsers repair) but work in a browser; for those only 404/410 (gone) is
reported. Timeouts are retried once. Prints a Markdown report and exits 1 if any
link is broken.
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "site" / "data" / "national_law.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"


def status(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # DNS, TLS, timeout
        return f"error: {type(e).__name__}: {e}"


def main():
    states = json.loads(DATA.read_text())["states"]
    broken = []
    for code, rec in sorted(states.items()):
        url = rec.get("source_url")
        if not url:
            broken.append((code, rec.get("state"), "(no source_url)", "missing"))
            continue
        st = status(url)
        if isinstance(st, str) and "timed out" in st:
            st = status(url)
        if isinstance(st, int) and 200 <= st < 300:
            continue
        if rec.get("source_check") == "blocked-but-canonical" and st not in (404, 410):
            continue
        broken.append((code, rec.get("state"), url, st))
    if not broken:
        print(f"All {len(states)} space-law source links load.")
        return 0
    print(f"{len(broken)} of {len(states)} space-law source links need attention:\n")
    print("| Code | State | Link | Result |\n|---|---|---|---|")
    for code, name, url, st in broken:
        print(f"| {code} | {name} | {url} | {st} |")
    return 1


if __name__ == "__main__":
    sys.exit(main())
