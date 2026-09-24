# STARS Observatory

[![Daily data refresh](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml/badge.svg)](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22662848.svg)](https://doi.org/10.5281/zenodo.22662848)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)

**A demonstrative evidence instrument for State obligations under Articles VI & IX of the Outer Space Treaty.**

**Live instrument → [starsobservatory.org](https://starsobservatory.org/)**

STARS Observatory fuses the public orbital catalog with the legal layer that governs it. Every tracked payload carries its Article VI responsible State and its UN registration status; the instrument propagates ~18,600 objects with SGP4 in the browser and turns treaty obligations into measurable quantities:

- **Article VI supervision burden** — payloads per responsible State, and the concentration of supervisory responsibility in a single licensing State.
- **Registration gap & lag** — payloads with no matching UN registration record, cross-referenced against GCAT, plus a live **Registration Lag Index**: a longitudinal ledger that observes payloads flipping from unregistered to registered and accrues per-State launch→registration latency distributions (running daily since 2026-07-11).
- **Supervisory machinery** — payload populations joined against the existence of national space legislation (UNOOSA National Space Law database).
- **Article IX decision-time compression** — a replayable case-study library (Aeolus/Starlink-44, Iridium 33/Cosmos 2251, Fengyun-1C, Cosmos 1408, Luch/Olymp) contrasting the orbital, machine, and diplomatic clocks.

For researchers, every view is citable and exportable:

- **Shareable views** — the address bar always encodes the current colour mode, filters, selected object and open dossier (e.g. `?color=state&state=PRC&type=PAY&reg=0`, `?sat=25544`, `?dossier=US`).
- **CSV export** — download exactly the objects the current filters select, with canonical TLE lines and the data-snapshot date.
- **State dossiers** — one card per responsible State combining supervision burden, registration gap and lag, national space legislation and constellations, with a ready-to-paste OSCOLA citation.

This is a demonstrative artifact supporting doctrinal analysis — **not an operational space situational awareness system**. See the in-app Provenance panel and [METHODOLOGY.md](METHODOLOGY.md) for framing, sources, and limitations.

## How it self-updates

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs daily at 06:00 UTC:

1. Re-fetches CelesTrak GP element sets & SATCAT and GCAT `psatcat` (a download only replaces the previous file if it validates).
2. Rebuilds the enriched dataset (`pipeline/build_dataset.py`), updating the registration lag ledger (`data/ledger.json` — committed daily as the persistent longitudinal record), and writes `sats.pack.json`, a lossless ~32% smaller transport copy of `sats.json` for the app's first load (`pipeline/pack_sats.py` refuses to write it unless it round-trips exactly). `sats.json` remains the canonical, archived snapshot.
3. Fails the run if the source element sets are stale (median epoch older than 3 days); a failed scheduled run opens a tracking issue.
4. Runs the QA gate (`tests/run_qa.mjs`) and, only if it passes, deploys the rebuilt site to GitHub Pages.

All page statistics are computed client-side from the generated JSON, so no HTML changes are needed between refreshes.

## Repository layout

```
site/        the static web instrument (Three.js + SGP4 worker)
pipeline/    data pipeline: refresh.py (fetch + orchestrate), build_dataset.py (enrich + ledger),
             pack_sats.py (compact transport copy), build_citation.py (citation manifest)
tests/       run_qa.mjs — QA gate that blocks deploys (citation, pickability, real clicks, exports)
data/        ledger.json — registration lag ledger (persistent state, committed daily)
```

## Running locally

```bash
python pipeline/refresh.py          # fetch fresh data and rebuild site/data/*.json
python -m http.server -d site 8000  # then open http://localhost:8000
```

## Data sources & attribution

- **[CelesTrak](https://celestrak.org/)** — GP element sets and SATCAT (T.S. Kelso), derived from US Space Force 18 SDS tracking data.
- **[GCAT](https://planet4589.org/space/gcat/)** — J. McDowell, General Catalog of Artificial Space Objects, used under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **[UNOOSA National Space Law database](https://www.unoosa.org/oosa/en/ourwork/spacelaw/nationalspacelaw/index.html)** — national space legislation status.
- **[NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble)** — Earth surface texture, courtesy NASA Earth Observatory.
- **[NASA Black Marble / Earth at Night](https://earthobservatory.nasa.gov/features/NightLights)** — night-lights texture, courtesy NASA Earth Observatory.
- **[Space-Track GP history mirror](https://huggingface.co/datasets/oxzoid/space-track-tle-history)** — archival general-perturbations element sets (US Space Surveillance Network via Space-Track.org) used to reconstruct the historical event replays.

### Third-party libraries (vendored)

- **[three.js](https://threejs.org/)** (incl. OrbitControls) — © 2010–present three.js authors, [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE).
- **[satellite.js](https://github.com/shashwatak/satellite-js)** — SGP4/SDP4 propagation, [MIT](https://github.com/shashwatak/satellite-js/blob/develop/LICENSE).

All other code, design, text, and the debris-cloud and replay engines are original work by the author (MIT). No trademarked assets or restricted imagery are used.

Please retain these attributions in any fork or derivative.

## Author

Built and maintained by **Hallam Burnapp**, PhD researcher in international space law, University of Aberdeen. The instrument supports doctoral research on State preventive obligations under Articles VI & IX of the Outer Space Treaty.

## Citation

The instrument generates its own citation at build time — open the **Provenance & citation** panel on the live site for a ready-to-copy OSCOLA citation carrying the exact version, data snapshot date and version DOI of the release you consulted. The OSCOLA templates are:

**Footnote:**

> Hallam Burnapp, 'STARS Observatory' (version \<VERSION\>, data snapshot \<SNAPSHOT DATE\>, University of Aberdeen 2026) DOI: \<VERSION DOI\>.

**Bibliography** (surname first, no trailing full stop):

> Burnapp H, 'STARS Observatory' (version \<VERSION\>, data snapshot \<SNAPSHOT DATE\>, University of Aberdeen 2026) DOI: \<VERSION DOI\>

where `<VERSION>` and `<VERSION DOI>` identify the archived release you used (the site fills these in automatically) and `<SNAPSHOT DATE>` is the date of the dataset you consulted, e.g. `13 September 2026`.

The **concept DOI** [10.5281/zenodo.22662848](https://doi.org/10.5281/zenodo.22662848) always resolves to the latest archived release; each release additionally receives its own **version DOI**, which is what the citation should carry (see `CITATION.cff`). Please also credit the underlying data sources listed above.

A BibTeX entry with the same metadata is available in the live site's Provenance & citation panel.

**How the citation stays resolvable.** The version DOI resolves permanently to the archived software release on Zenodo. The data snapshot date identifies the day's generated dataset behind every figure — and each day's dataset is preserved as `snapshot-YYYY-MM-DD.tar.gz` in the companion [daily data archive](https://github.com/hallamburnapp-cloud/stars-observatory-data/releases/tag/data-archive), so a cited snapshot remains retrievable after the live site refreshes.

## License

© 2026 Hallam Burnapp. All rights reserved.

Code: MIT (see LICENSE). Generated datasets: CC-BY 4.0, inheriting GCAT's attribution requirement.
