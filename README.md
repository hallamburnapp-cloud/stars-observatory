# STARS Observatory

[![Daily data refresh](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml/badge.svg)](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml)
[![DOI](https://zenodo.org/badge/1355854787.svg)](https://zenodo.org/badge/latestdoi/1355854787)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)

**A demonstrative evidence instrument for State obligations under Articles VI & IX of the Outer Space Treaty.**

**Live instrument → [hallamburnapp-cloud.github.io/stars-observatory](https://hallamburnapp-cloud.github.io/stars-observatory/)**

STARS Observatory fuses the public orbital catalog with the legal layer that governs it. Every tracked payload carries its Article VI responsible State and its UN registration status; the instrument propagates ~18,600 objects with SGP4 in the browser and turns treaty obligations into measurable quantities:

- **Article VI supervision burden** — payloads per responsible State, and the concentration of supervisory responsibility in a single licensing State.
- **Registration gap & lag** — payloads with no matching UN registration record, cross-referenced against GCAT, plus a live **Registration Lag Index**: a longitudinal ledger that observes payloads flipping from unregistered to registered and accrues per-State launch→registration latency distributions (running daily since 2026-07-11).
- **Supervisory machinery** — payload populations joined against the existence of national space legislation (UNOOSA National Space Law database).
- **Article IX decision-time compression** — a replayable case-study library (Aeolus/Starlink-44, Iridium 33/Cosmos 2251, Fengyun-1C, Cosmos 1408, Luch/Olymp) contrasting the orbital, machine, and diplomatic clocks.

This is a demonstrative artifact supporting doctrinal analysis — **not an operational space situational awareness system**. See the in-app Provenance panel and [METHODOLOGY.md](METHODOLOGY.md) for framing, sources, and limitations.

## How it self-updates

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs daily at 06:00 UTC:

1. Re-fetches CelesTrak GP element sets & SATCAT and GCAT `psatcat` (a download only replaces the previous file if it validates).
2. Rebuilds the enriched dataset (`pipeline/build_dataset.py`), updating the registration lag ledger (`data/ledger.json` — committed daily as the persistent longitudinal record).
3. Deploys the rebuilt site to GitHub Pages.

All page statistics are computed client-side from the generated JSON, so no HTML changes are needed between refreshes.

## Repository layout

```
site/        the static web instrument (Three.js + SGP4 worker)
pipeline/    data pipeline: refresh.py (fetch + orchestrate), build_dataset.py (enrich + ledger)
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

Please retain these attributions in any fork or derivative.

## Author

Built and maintained by **Hallam Burnapp**, PhD researcher in international space law, University of Aberdeen. The instrument supports doctoral research on State preventive obligations under Articles VI & IX of the Outer Space Treaty.

## Citation

If you use the instrument or the lag ledger dataset in academic work, please cite the repository (a Zenodo DOI is planned) and the underlying sources above.

## License

Code: MIT (see LICENSE). Generated datasets: CC-BY 4.0, inheriting GCAT's attribution requirement.
