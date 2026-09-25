# STARS Observatory

[![Daily data refresh](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml/badge.svg)](https://github.com/hallamburnapp-cloud/stars-observatory/actions/workflows/refresh.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22662848.svg)](https://doi.org/10.5281/zenodo.22662848)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)

**A demonstrative evidence instrument for State obligations under Articles VI & IX of the Outer Space Treaty.**

**Live instrument → [starsobservatory.org](https://starsobservatory.org/)**

STARS Observatory is a demonstrative evidence instrument. Each day it takes the public catalogue of objects in Earth orbit and shows the legal layer that governs them. It propagates the public element sets of about nineteen thousand objects (CelesTrak's active-satellite set plus four historical debris clouds) with SGP4 in the browser, and presents three analytical layers:

- **Per-State supervision burden** — payloads per attributed State (SATCAT owner code, an evidentiary proxy), and how the public catalogue concentrates them.
- **Registration lag** — payloads with no matching UN record, cross-referenced against GCAT's UN registration field, with the treaty party status of each attributed State (UNOOSA status document), plus a live **Registration Lag Index**: a longitudinal ledger that observes payloads gaining a matching UN record and accrues launch→registration latency distributions (running daily since 2026-07-11).
- **Article IX incident replays** — a case-study library (Aeolus/Starlink-44, Iridium 33/Cosmos 2251, Fengyun-1C, Cosmos 1408, Luch/Olymp) setting out each fact pattern — what was knowable, when, by whom, over what time window — with archival-element-set replays.

A **Provenance** panel sets out the data sources, methods, matching rules and limits.

The attributed State is the owner code in the public catalogue, used as an evidentiary proxy only: it is not the launching State, the State of registry, or a determination of the "appropriate State Party" under Article VI of the Outer Space Treaty. A missing UN registration match is not a finding of non-compliance.

For researchers, every view is citable and exportable:

- **Shareable views** — the address bar always encodes the current colour mode, filters and selected object (e.g. `?color=state&state=PRC&type=PAY&reg=0`, `?sat=25544`).
- **CSV export** — download exactly the objects the current filters select, with the canonical element-set lines and the data-snapshot date.

This is not an operational space situational awareness system. See the in-app Provenance panel and [METHODOLOGY.md](METHODOLOGY.md) for framing, sources and limitations.

## How it self-updates

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs daily at 06:00 UTC:

1. Re-fetches CelesTrak GP element sets (OMM, JSON) and SATCAT (CSV), and GCAT `psatcat` (TSV); a download only replaces the previous file if it validates.
2. Rebuilds the enriched dataset (`pipeline/build_dataset.py`), updating the registration lag ledger (`data/ledger.json` — committed daily as the persistent longitudinal record), and writes `sats.pack.json`, a lossless ~32% smaller transport copy of `sats.json` for the app's first load (`pipeline/pack_sats.py` refuses to write it unless it round-trips exactly). `sats.json` remains the canonical, archived snapshot.
3. Fails the run if the source element sets are stale (median epoch older than 3 days); a failed scheduled run opens a tracking issue.
4. Runs the QA gate (`tests/run_qa.mjs`) and, only if it passes, deploys the rebuilt site to GitHub Pages.

All page statistics are computed client-side from the generated JSON, so no HTML changes are needed between refreshes.

## Repository layout

```
site/        the static web instrument (Three.js + SGP4 worker)
pipeline/    data pipeline: refresh.py (fetch + orchestrate), build_dataset.py (enrich + ledger),
             pack_sats.py (compact transport copy), build_citation.py (citation manifest),
             build_histevents.py (static incident-replay data)
tools/       build_treaty_status.py — rebuilds site/data/treaty_status.json from the UNOOSA status document
tests/       run_qa.mjs — QA gate that blocks deploys (citation, pickability, real clicks, exports)
data/        ledger.json — registration lag ledger (persistent state, committed daily)
```

## Releasing

1. Bump `version` and `date-released` in `CITATION.cff` on `main`, and add `.github/release-notes/v<version>.md`.
2. Actions → **Release** → Run workflow → enter the version.

The workflow publishes the GitHub release, which Zenodo archives to mint the version DOI (this can take over half an hour when Zenodo is busy). It waits up to 2 hours for that, then redeploys so the site's OSCOLA citation carries the new version DOI; any later archive is picked up by the next daily refresh. Until then the citation uses the concept DOI, never another release's DOI.

## Running locally

```bash
python pipeline/refresh.py          # fetch fresh data and rebuild site/data/*.json
python -m http.server -d site 8000  # then open http://localhost:8000
```

## Data sources & attribution

Live catalogue data are drawn from CelesTrak (GP data in OMM JSON; SATCAT in CSV). Registration matching uses Jonathan McDowell's General Catalog of Artificial Space Objects (GCAT), CC BY 4.0. Historical element sets used for incident replays are drawn from a publicly hosted mirror of Space-Track history. Earth imagery: NASA Blue Marble. Treaty status: UNOOSA.

- **[CelesTrak](https://celestrak.org/)** — GP element sets (OMM, JSON) and SATCAT (CSV) (T.S. Kelso), derived from US Space Force 18 SDS tracking data.
- **[GCAT](https://planet4589.org/space/gcat/)** — J. McDowell, General Catalog of Artificial Space Objects, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **[UNOOSA, Status of International Agreements relating to activities in outer space as at 1 January 2026](https://www.unoosa.org/unoosa/uploads/res/oosadoc/data/documents/2026/aac_105c_22026crp/aac_105c_22026crp_9rev_1_0_html/AC105_C2_2026_CRP09Rev01E.pdf)** — UN Doc A/AC.105/C.2/2026/CRP.9/Rev.1; sole source of treaty party status.
- **[NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble)** — Earth surface texture, courtesy NASA Earth Observatory.
- **NASA Black Marble / Earth at Night** — night-lights texture, courtesy NASA Earth Observatory.
- **[Space-Track GP history mirror (oxzoid/space-track-tle-history, Hugging Face)](https://huggingface.co/datasets/oxzoid/space-track-tle-history)** — archival general-perturbations element sets (US Space Surveillance Network via Space-Track.org) used to reconstruct the historical event replays.

### Third-party libraries and fonts

- **[three.js](https://threejs.org/)** (incl. OrbitControls) — © 2010–present three.js authors, [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE) (vendored).
- **[satellite.js](https://github.com/shashwatak/satellite-js)** v5.0.0 — SGP4/SDP4 propagation, [MIT](https://github.com/shashwatak/satellite-js/blob/develop/LICENSE.md) (vendored).
- **[IBM Plex Sans and IBM Plex Mono](https://github.com/IBM/plex)** — self-hosted in `site/fonts`, [SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt).

All other code, design, text, and the debris-cloud and replay engines are original work by the author (MIT). No trademarked assets or restricted imagery are used.

Please retain these attributions in any fork or derivative.

## Author

Built and maintained by **Hallam Burnapp**. The instrument supports doctoral research on State preventive obligations under Articles VI & IX of the Outer Space Treaty. See the About panel on the live site.

## Citation

The instrument generates its own citation — open the **About** panel on the live site for a ready-to-copy OSCOLA citation carrying the exact version, data snapshot date and version DOI of the release you consulted. The OSCOLA templates are:

**Footnote:**

> Hallam Burnapp, 'STARS Observatory' (version \<VERSION\>, data snapshot \<SNAPSHOT DATE\>) DOI: \<VERSION DOI\>.

**Bibliography** (surname first, no trailing full stop):

> Burnapp H, 'STARS Observatory' (version \<VERSION\>, data snapshot \<SNAPSHOT DATE\>) DOI: \<VERSION DOI\>

where `<VERSION>` and `<VERSION DOI>` identify the archived release you used (the site fills these in automatically) and `<SNAPSHOT DATE>` is the date of the dataset you consulted, e.g. `13 September 2026`. Following OSCOLA 5, a citation that carries a DOI gives no URL or access date; the BibTeX entry records both (`url`, `urldate`).

The **concept DOI** [10.5281/zenodo.22662848](https://doi.org/10.5281/zenodo.22662848) always resolves to the latest archived release; each release additionally receives its own **version DOI**, which is what the citation should carry (see `CITATION.cff`). Please also credit the underlying data sources listed above.

A BibTeX entry with the same metadata is available in the live site's About panel.

**How the citation stays resolvable.** The version DOI resolves permanently to the archived software release on Zenodo. The data snapshot date identifies the day's generated dataset behind every figure — and each day's dataset is preserved as `snapshot-YYYY-MM-DD.tar.gz` in the companion [daily data archive](https://github.com/hallamburnapp-cloud/stars-observatory-data/releases/tag/data-archive), so a cited snapshot remains retrievable after the live site refreshes.

## License

© 2026 Hallam Burnapp.

Code: MIT (see LICENSE). Data and snapshots: CC BY 4.0, inheriting GCAT's attribution requirement. The STARS Observatory name is not covered by these licences.
