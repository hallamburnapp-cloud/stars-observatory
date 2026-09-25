# Methodological Note on STARS Observatory as a Demonstrative Evidence Instrument

**Prepared for supervisory discussion — PhD thesis on State preventive obligations under Articles VI and IX of the Outer Space Treaty for AI-enabled harmful interference with satellite systems**

---

## 1. Purpose of this note

This note sets out the methodological status of STARS Observatory, the demonstrative evidence instrument built to support the thesis, and specifically for the final chapter's proposed 'STARS Framework' for operationalising Articles VI and IX preventive obligations. It anticipates questions the supervisor, and in due course examiners, are likely to raise about what kind of evidence — if any — a computational artefact can contribute to a doctrinal international law thesis. In short: the instrument is not evidence in the scientific or forensic sense; it is a **demonstrative evidence instrument** that renders visible, for doctrinal argument, structural features of the current space governance regime otherwise buried in dispersed registries, treaty text and technical literature. Its epistemic function is illustrative, not probative.

## 2. What the instrument is, and what it is not

The instrument fuses public data sources: CelesTrak's General Perturbations (GP) element sets for the active-satellite population plus four historical debris clouds, about 19,000 objects propagated in the browser, which are themselves derived from tracking performed by the 18th Space Defense Squadron (18 SDS) of the US Space Force;[^1] CelesTrak's SATCAT, used for catalogue-wide statistics and comprising 34,872 catalogued on-orbit objects in the 24 September 2026 data snapshot;[^2] Jonathan McDowell's General Catalog of Artificial Space Objects (GCAT), whose UNReg field serves as a proxy for UN registration status;[^3] and, for the treaty party status of each attributed State, the annual status document of the United Nations Office for Outer Space Affairs (UNOOSA).[^4] From these it presents three analytical layers and a provenance panel: 01 per-State supervision burden (attributed State); 02 Registration lag (the share of payloads with no matching UN record, with the attributed State's treaty party status, plus the live Registration Lag Index); 03 Article IX incident replays (a decision-time 'three clocks' view plus a case-study library with archival-element-set replays, beginning with the September 2019 ESA Aeolus/Starlink-44 conjunction); and 04 Provenance and limitations.

What this instrument is **not**:

- It is **not** an empirical study in the social-scientific sense of testing a falsifiable hypothesis against a sampled dataset with a defined error model. The 'findings' it displays (as of the 24 September 2026 data snapshot: 33.3% of payloads on orbit with no matching UN record in GCAT; 68.7% of payloads with the United States as attributed State (SATCAT owner code); Starlink accounting for 65.4% of active payloads, roughly two-thirds) are descriptive tabulations of public catalogue data, not statistical inferences requiring confidence intervals.
- It is **not** a space situational awareness (SSA) tool and makes no claim to rival, replicate or improve upon national or commercial SSA capabilities (eg the US Space Surveillance Network, EU SST, or commercial providers such as LeoLabs). The underlying orbital data is a public, deliberately filtered and lower-fidelity (general-perturbations) subset of what such systems hold internally (Section 4).
- It is **not** a prediction engine for future conjunctions or a risk-assessment tool for operational decision-making. The Aeolus/Starlink-44 replay, like the other case-study replays, is a historical reconstruction from published facts and archival element sets, not a forward-looking simulation of collision probability.

Its function is instead to **operationalise, in visible and interactive form, propositions that the thesis defends discursively** — namely, that the 'space object' is an inadequate unit of legal analysis for AI-mediated risk, that 'continuing supervision' under Article VI lacks operational content, that States lack timely operational control over the conduct that triggers their responsibility, and that AI systems compress the decision-time within which Article IX's 'due regard' and consultation obligations must be discharged.

## 3. Methodological situation: empirically-informed doctrinal scholarship

The thesis is, and remains, a work of doctrinal international law: its central claims are normative interpretations of treaty text (Articles VI and IX of the Outer Space Treaty)[^5] supported by travaux préparatoires, State practice, and juristic opinion. The instrument sits within what might be termed **empirically-informed doctrinal scholarship**, or a socio-legal supplement to treaty interpretation: a mode of legal research that uses external, non-legal data not to generate legal rules inductively, but to test the descriptive premises on which a doctrinal argument depends, and to communicate the scale of a regulatory gap that words alone tend to understate.

This mode has clear precedent. Quantitative and computational artefacts have a growing, if still marginal, place in legal scholarship. Randal Picker's 'SimLaw' project used agent-based computer simulation to explore how 'organized decision making' may differ markedly from the decision-making of the isolated, boundedly rational individuals on whom the behavioural law-and-economics critique of the rational-actor model concentrates, explicitly framing simulation as an increasingly attractive alternative to closed-form economic modelling, experiments with live subjects and costly data collection.[^6] More recent work on agent-based modelling as a 'legal theory tool' argues that ABM's main strength lies in demonstrating how unexpected system-level properties can arise from simple models of individual behaviour, retaining both the advantages and some of the disadvantages of law-and-economics modelling;[^7] related work describes agent-based simulation as enabling researchers 'to generate social systems artefacts that can be observed, evaluated, and tested on a computer'.[^8] A parallel literature on 'computational legal empiricism' in socio-legal studies similarly frames simulation and computational artefacts as tools for exploring legal phenomena that resist purely textual or statistical treatment, while stressing that such artefacts remain heuristic rather than dispositive. Surveys of 'computational legal studies' similarly distinguish 'law-as-code' and 'law-as-data' approaches from doctrinal argument, treating them as complementary evidentiary supplements rather than replacements. STARS Observatory belongs to this same family: a bespoke, single-purpose data visualisation built to substantiate a doctrinal claim about regulatory gaps, not a generalisable predictive model.

Space law scholarship itself already draws on quantitative registration data to make doctrinal arguments about compliance gaps — for example, work quantifying registration delay and non-registration rates by State to argue that the Registration Convention's transparency objective is only partially realised.[^9] The instrument situates the thesis within this established tradition of quantitatively-supplemented space law doctrine, rather than inventing a new genre.

## 4. Data provenance and honest limitations

Methodological candour requires the thesis to document, prominently, the limitations of each data source.

**CelesTrak / 18 SDS GP data.** All orbital elements ultimately derive from tracking performed by the US Space Force's 18th Space Defense Squadron via the Space Surveillance Network, disseminated publicly through Space-Track.org and mirrored by CelesTrak.[^10] This entails several material limitations: (i) Two-Line Element (TLE) / GP data encode *mean*, not osculating, orbital elements fitted to a specific propagation model (SGP4), and are subject to positional error that empirical studies place at roughly 1–2 kilometres or worse for uncooperatively tracked objects, improving substantially (by around half, in one recent study of Starlink data) only where operator-supplied ephemerides are used to generate 'supplemental' TLEs;[^11] (ii) the public catalogue is a deliberately filtered version of what 18 SDS tracks internally — classified payloads, certain national-security assets, and 'analyst objects' whose launch of origin cannot be determined are excluded or withheld from the public SATCAT;[^12] (iii) the catalogue is a snapshot, decaying in accuracy between updates and undergoing structural transition now that the five-digit catalogue-number space has been exhausted: CelesTrak reports that five-digit numbers ran out on 11 July 2026, and catalogue numbers above 99,999 appear in the September 2026 snapshot.[^13] The instrument's population counts (about 19,000 propagated objects; 34,872 catalogued on-orbit objects, including 19,976 payloads, in the 24 September 2026 snapshot) should therefore be read as a lower-bound, public-domain approximation of the true on-orbit population, not a complete census.

**Formats.** GP element sets are retrieved from CelesTrak in OMM format (JSON), the SATCAT in CSV and GCAT's payload catalogue in TSV; no TLE-format file is ingested. The pipeline writes each OMM record as a pair of two-line element lines only for SGP4 propagation in the browser, and the browser re-encodes catalogue numbers above 99,999, which the two-line format cannot hold, in the Alpha-5 form so that they parse. Objects without public element sets are counted in totals but not propagated in the 3D view.

**GCAT.** Jonathan McDowell's General Catalog of Artificial Space Objects is a meticulously maintained, but privately compiled and unofficial, cross-reference resource used here solely to link SATCAT/GP entries to UN registration status.[^14] Its UNReg field records the UN registration document, if any, in which an object has been registered; a 'no matching UN record' flag therefore means an object with no UN registration reference recorded in GCAT, an unofficial secondary transcription of UN Register documents, not a reading of the UN Register itself.[^15] It is not itself an intergovernmental record and inherits any errors or omissions in its source material.

**Registration lag.** The 33.3% no-matching-record figure must be read against the Registration Convention's own silence on any deadline: Article IV(1) requires States of registry to furnish particulars only 'as soon as practicable', a standard that in practice produces registration delays ranging from months to several years.[^16] Some proportion of the 33.3% is therefore lag, and a missing match is not a finding of non-compliance: an object may be registered by a different launching State (art II(2)), by an intergovernmental organisation (art VII), or following a transfer of ownership (UNGA Res 62/101),[^17] and States not party to the Convention may register under UNGA Res 1721 B (XVI). The figure should be presented in the thesis with this caveat attached at first mention and in any summary table.

**Attribution conventions.** The attributed State is the owner code assigned in the public satellite catalogue. It is used as an evidentiary proxy only. It is not the launching State (Liability Convention art I(c); Registration Convention art I(a)), not the State of registry (Outer Space Treaty art VIII), and not a determination of the "appropriate State Party" under Outer Space Treaty art VI, which may be more than one State.

The 68.7% figure is calculated by payload count using the SATCAT OWNER field (the SATCAT has no launching-State field),[^18] a convention that elides the more complex multi-State launching-State determinations the Registration Convention itself contemplates (Article II(2)) and that has generated its own scholarly gap literature, notably on NSS-6 and NSS-7, in respect of which the Netherlands, the State of their Dutch owner, declared that it was not a launching State.[^19] The figure is a proxy for the concentration of attribution in the public catalogue, not a legal determination of Article VI responsibility (or of Article VII / Liability Convention liability) in any specific case.[^20]

Intergovernmental organisations such as ESA and EUMETSAT have declared acceptance of the Registration Convention under art VII and register objects directly. Under Outer Space Treaty arts VI and XIII, responsibility for their activities is borne jointly by the organisation and its participating States. Some organisation-procured objects are registered by a member State rather than by the organisation, which can appear here as a non-match.

**Treaty party status.** The party, signatory or neither status shown for each attributed State under the Outer Space Treaty, the Liability Convention and the Registration Convention is taken solely from UNOOSA's status document as at 1 January 2026 (UN Doc A/AC.105/C.2/2026/CRP.9/Rev.1), and is displayed with that symbol and date.[^4] Nothing is inferred from any other source. The document's table and its own 'Total' row differ by one entry in two columns (78 against 77 ratifications of the Registration Convention; 22 against 23 signatures of the Outer Space Treaty); the instrument shows each State as the table records it.

## 5. What each panel demonstrates for the Article VI/IX argument and the STARS Framework

**Panel 01 — Per-State supervision burden (attributed State)** (as of the 24 September 2026 data snapshot: 11,136 Starlink payloads, 65.4% of 17,031 active payloads, approximately two-thirds of the active population; 13,723 of 19,976 payloads on orbit, 68.7%, with the United States as attributed State (SATCAT owner code)) demonstrates empirically the thesis's claim that the 'unit of risk' in contemporary orbital operations is the *integrated satellite system* — a single operator's constellation, sharing software, autonomous collision-avoidance logic and ground-segment decision architecture — rather than the discrete 'space object' that Articles VII–IX and the Liability and Registration Conventions take as their conceptual unit.[^21] A regime built around individual object-by-object attribution struggles doctrinally when one non-governmental actor's AI-mediated fleet-management system governs thousands of objects as a single behavioural entity. The same panel's concentration of attribution (68.7% of payloads with the United States as attributed State) illustrates the practical asymmetry between the diffuse, multilateral drafting assumptions of Article VI (a treaty negotiated when a handful of States conducted space activities) and a present reality in which the public catalogue attributes most payloads to one or two States, principally in respect of non-governmental commercial actors whose AI-enabled operational decisions occur at machine speed. This grounds the STARS Framework's argument for differentiated, capacity-sensitive operationalisation of 'continuing supervision' rather than a uniform standard.

**Panel 02 — Registration lag and Registration Lag Index** (as of the 24 September 2026 data snapshot: 6,646 of 19,976 payloads, 33.3%, with no matching UN record in GCAT; the Registration Lag Index ledger, running since 11 July 2026, has observed 765 registrations with a median observed lag of 411 days) demonstrates, subject to the registration-lag caveat in Section 4, that the transparency infrastructure Article VI's 'continuing supervision' duty implicitly relies upon — knowing what is in orbit, under whose authority — is itself structurally incomplete. This directly supports the thesis's claim that 'continuing supervision' is content-thin: a State cannot meaningfully supervise activities of objects that are neither timely nor completely disclosed to the very institutional mechanism (the UN Register) designed to render supervision internationally visible.[^22]

**Panel 03 — Article IX: incident replays ('three clocks' view and case-study library)** replays, from archival element sets, the September 2019 near-encounter between ESA's Aeolus satellite and SpaceX's Starlink-44, and sets out its fact pattern: what was knowable, when, by whom and over what time window. When the two operators exchanged emails on 28 August 2019, the collision probability was about 1 in 50,000 and SpaceX indicated that it had no plan to act; the probability then rose to about 1 in 1,000 — ten times ESA's own manoeuvre threshold — while a software fault in SpaceX's on-call paging system meant the Starlink operator did not see ESA's follow-up; ESA manoeuvred Aeolus on 2 September 2019.[^23] Article IX's consultation clause applies where a State Party 'has reason to believe' that an activity 'would cause potentially harmful interference' with activities of other States Parties.[^24] The replay records that, in this episode, the interval between the risk-relevant data update and the point by which a manoeuvre decision had to be executed was measured in days. The thesis draws on this documented fact pattern for its argument that AI-mediated operational tempo compresses the time within which Article IX's due-regard and consultation provisions operate, and so motivates the STARS Framework's proposal for pre-authorised, automated escalation thresholds as a way of preserving meaningful State oversight within compressed decision windows. The panel's case-study library sets out the fact patterns of four further episodes in the same way: Iridium 33/Cosmos 2251 (2009), Fengyun-1C (2007), Cosmos 1408 (2021) and Luch/Olymp (2014–26).

**Panel 04 — Provenance and limitations** sets out, within the instrument itself, the source limitations documented in Section 4.

## 6. Anticipated examiner objections and responses

*Objection 1: 'This is data journalism, not legal research.'* Response: the instrument does not purport to establish legal conclusions from data; it establishes descriptive premises (population concentration, registration incompleteness, decision-time compression) that the doctrinal chapters then subject to legal analysis. The distinction mirrors accepted practice in comparative and empirical legal scholarship, where quantitative description of a regulatory landscape precedes, and is analytically separate from, normative argument about that landscape's adequacy.

*Objection 2: 'The data is incomplete, so the findings are unreliable.'* Response: incompleteness is disclosed as a feature, not concealed as a flaw (Section 4). The thesis's argument does not depend on precise figures but on order-of-magnitude claims — that a substantial, non-trivial proportion of the on-orbit population has no matching UN record, and that attribution is heavily concentrated — which are robust to the margins of error involved and are corroborated by independent scholarship using overlapping but distinct methodologies.[^25]

*Objection 3: 'You are claiming your instrument out-performs classified SSA systems.'* Response: no such claim is made, and the note above expressly disclaims it. The instrument's value lies precisely in showing what is knowable from the *public* record available to non-State observers, other States, and civil society — which is itself the relevant baseline for assessing whether Article VI's transparency-dependent 'continuing supervision' duty is operable by any actor other than the small number of States with access to classified tracking data.

*Objection 4: 'A one-off historical replay of a single incident cannot support a generalisable doctrinal claim.'* Response: Aeolus/Starlink-44 is deployed as an illustrative case study, in the established common-law and doctrinal tradition of the exemplary case, not as a statistical sample. Its evidentiary weight rests on its being, in ESA's words, the first time ESA performed a collision-avoidance manoeuvre to protect one of its spacecraft from a satellite in a large constellation, and on the fact pattern being independently corroborated by ESA, SpaceX and contemporaneous press accounts,[^26] not on volume of repetition.

*Objection 5: 'Why build a 3D instrument at all, rather than a table?'* Response: the visual and interactive form is itself part of the argument. Article VI and IX's obligations are frequently discussed in the abstract; rendering the actual scale and density of the constellation, and the ownership concentration within it, communicates a claim about regulatory salience that tabular data can understate. This follows the rationale articulated in the ABM-in-legal-theory literature for treating computational artefacts as tools that make emergent, systemic features of a regulatory environment newly visible to doctrinal analysis.[^27]

## 7. Conclusion

The instrument's contribution to the thesis is heuristic and expository, not evidentiary. It converts publicly available but institutionally fragmented data — CelesTrak/18 SDS tracking data, the SATCAT, McDowell's GCAT cross-reference and UNOOSA's treaty status record — into a single demonstrative evidence instrument that renders visible the structural mismatches between Articles VI and IX's drafting-era assumptions and the present reality of AI-mediated mega-constellation operations. Every descriptive figure it displays is documented, caveated and traceable to public sources; every doctrinal conclusion the thesis draws from it is defended independently through conventional treaty interpretation, State practice and juristic authority. Read this way, the instrument strengthens rather than substitutes for the doctrinal argument, and situates the thesis within an established, if still emerging, tradition of empirically-informed and computationally-supplemented international legal scholarship.

## How it was made

The author designed this instrument, defined its legal categories and verified its classifications; software and web design was prepared with agentic coding under the author's direction.

---

[^1]: TS Kelso, 'Current GP Element Sets' (*CelesTrak*) <https://celestrak.org/NORAD/elements/> accessed 24 September 2026; 'Documentation' (*Space-Track.org*) <https://www.space-track.org/documentation> accessed 24 September 2026.

[^2]: 'SATCAT Format Documentation' (*CelesTrak*) <https://celestrak.org/satcat/satcat-format.php> accessed 24 September 2026.

[^3]: Jonathan C McDowell, 'GCAT: General Catalog of Artificial Space Objects' (*Jonathan's Space Report*) <https://planet4589.org/space/gcat/> accessed 24 September 2026; Jonathan C McDowell, 'Payload Catalog Column Descriptions' (*Jonathan's Space Report*) <https://planet4589.org/space/gcat/web/cat/pcols.html> accessed 24 September 2026. See also 'What Is Jonathan McDowell's GCAT, and Why Is It Important?' (*New Space Economy*, 10 March 2026) <https://newspaceeconomy.ca/2026/03/10/jonathan-mcdowells-gcat-and-why-it-matters/> accessed 24 September 2026.

[^4]: UNOOSA, 'Status of International Agreements relating to activities in outer space as at 1 January 2026' (17 April 2026) UN Doc A/AC.105/C.2/2026/CRP.9/Rev.1.

[^5]: Treaty on Principles Governing the Activities of States in the Exploration and Use of Outer Space, Including the Moon and Other Celestial Bodies (opened for signature 27 January 1967, entered into force 10 October 1967) 610 UNTS 205 ('Outer Space Treaty') arts VI, IX.

[^6]: Randal C Picker, 'SimLaw 2011' [2002] U Ill L Rev 1019, 1019–23. See also Richard H McAdams and Thomas S Ulen, 'Introduction' [2002] U Ill L Rev 791, 797.

[^7]: Sebastian Benthall and Katherine J Strandburg, 'Agent-Based Modeling as a Legal Theory Tool' (2021) 9 Frontiers in Physics 666386.

[^8]: Margherita Vestoso and Ilaria Cecere, 'Exploring the Intersections between Law, ABM and Policy-Making: On the Clash between Formal and Informal Norms' (1st Workshop on Agent-based Modeling and Policy-Making (AMPM 2021), Vilnius, 8 December 2021), CEUR Workshop Proceedings vol 3182, 2 <https://ceur-ws.org/Vol-3182/paper16.pdf> accessed 24 September 2026.

[^9]: Ram S Jakhu, Bhupendra Jasani and Jonathan C McDowell, 'Critical Issues Related to Registration of Space Objects and Transparency of Space Activities' (2018) 143 Acta Astronautica 406.

[^10]: 'Documentation' (*CelesTrak*) <https://celestrak.org/NORAD/documentation/> accessed 24 September 2026; 'Documentation' (*Space-Track.org*) (n 1).

[^11]: Charles Constant, Santosh Bhattarai and Marek Ziebart, 'Limitations of Current Practices in Uncooperative Space Surveillance: Analysis of Mega-Constellation Data Time-Series' (Advanced Maui Optical and Space Surveillance Technologies Conference, Maui, 2023) <https://amostech.com/TechnicalPapers/2023/Poster/Constant.pdf> accessed 24 September 2026; 'Documentation' (*CelesTrak*) (n 10).

[^12]: 'Frequently Asked Questions (FAQs)' (*NASA Conjunction Assessment Risk Analysis*) <https://www.nasa.gov/cara/frequently-asked-questions/> accessed 24 September 2026.

[^13]: Kelso (n 1).

[^14]: McDowell, 'GCAT' (n 3); 'What Is Jonathan McDowell's GCAT, and Why Is It Important?' (n 3).

[^15]: McDowell, 'Payload Catalog Column Descriptions' (n 3). cf 'United Nations Register of Objects Launched into Outer Space' (*United Nations Office for Outer Space Affairs*) <https://www.unoosa.org/oosa/en/spaceobjectregister/index.html> accessed 24 September 2026.

[^16]: Convention on Registration of Objects Launched into Outer Space (opened for signature 14 January 1975, entered into force 15 September 1976) 1023 UNTS 15 ('Registration Convention') art IV(1); Jakhu, Jasani and McDowell (n 9). See also Natercia Rodrigues, 'Registration of Space Objects: Requirements and Procedures' (KiboCUBE Regulatory Webinar, 11 September 2023) <https://www.unoosa.org/documents/pdf/Access2Space4All/KiboCUBE/RegulatoryWebinar/KiboCUBE_Regulatory_Webinar_Registration_of_Space_Objects_Rodrigues.pdf> accessed 24 September 2026.

[^17]: UNGA Res 62/101 (17 December 2007) UN Doc A/RES/62/101.

[^18]: 'SATCAT Format Documentation' (n 2).

[^19]: Registration Convention, art II(2); Note verbale dated 29 July 2003 from the Permanent Mission of the Netherlands to the United Nations (Vienna) addressed to the Secretary-General (22 August 2003) UN Doc A/AC.105/806; Jack Wright Nelson, 'Lost in Space? Gaps in the International Space Object Registration Regime' (*EJIL: Talk!*, 19 November 2018) <https://www.ejiltalk.org/lost-in-space-gaps-in-the-international-space-object-registration-regime/> accessed 24 September 2026.

[^20]: Outer Space Treaty, arts VI, VII; Convention on International Liability for Damage Caused by Space Objects (opened for signature 29 March 1972, entered into force 1 September 1972) 961 UNTS 187 ('Liability Convention').

[^21]: Outer Space Treaty, arts VII–IX; Liability Convention; Registration Convention.

[^22]: 'United Nations Register of Objects Launched into Outer Space' (n 15); 'Online Index of Objects Launched into Outer Space' (*United Nations Office for Outer Space Affairs*) <https://www.unoosa.org/oosa/osoindex/index.jspx> accessed 24 September 2026.

[^23]: 'ESA Spacecraft Dodges Large Constellation' (*European Space Agency*, 3 September 2019) <https://www.esa.int/Space_Safety/ESA_spacecraft_dodges_large_constellation> accessed 24 September 2026. For the 28 August 1-in-50,000 estimate and the paging fault, see SpaceX's statements reported in Alan Boyle, 'SpaceX Reports a "Bug" in Its Alert System after ESA Shifts Spacecraft to Avoid Starlink Satellite Collision' (*GeekWire*, 3 September 2019) <https://www.geekwire.com/2019/esa-shifts-spacecraft-avoid-starlink-satellite-spacex-reports-bug-collision-warning-system/> accessed 24 September 2026; Mike Wall, 'European Satellite Dodges Potential Collision with SpaceX Starlink Craft' (*Space.com*, 3 September 2019) <https://www.space.com/spacex-starlink-esa-satellite-collision-avoidance.html> accessed 24 September 2026.

[^24]: Outer Space Treaty, art IX.

[^25]: Jakhu, Jasani and McDowell (n 9); Wright Nelson (n 19).

[^26]: 'ESA Spacecraft Dodges Large Constellation' (n 23); Wall (n 23); Charlotte Jee, 'One of SpaceX's Starlink Satellites Almost Collided with a Weather Satellite' (*MIT Technology Review*, 2 September 2019) <https://www.technologyreview.com/2019/09/02/133180/one-of-spacexs-starlink-satellites-almost-collided-with-a-weather-forecasting-satellite/> accessed 24 September 2026; Devin Coldewey, 'Near Miss between Science Craft and Starlink Satellite Shows Need to Improve Orbital Coordination' (*TechCrunch*, 3 September 2019) <https://techcrunch.com/2019/09/03/near-miss-between-science-craft-and-starlink-satellite-shows-need-to-improve-orbital-coordination/> accessed 24 September 2026; Marcia Smith, 'ESA Urges Automated Satellite Collision Avoidance Systems After Aeolus/Starlink Maneuver' (*SpacePolicyOnline.com*, 3 September 2019) <https://spacepolicyonline.com/news/esa-urges-automated-satellite-collision-avoidance-systems-after-aeolus-starlink-maneuver/> accessed 24 September 2026.

[^27]: Benthall and Strandburg (n 7).

---

## Bibliography

*Treaties and UN documents cited in the footnotes are primary sources and are not listed here (OSCOLA §1.7).*

—— 'Documentation' (*CelesTrak*) <https://celestrak.org/NORAD/documentation/> accessed 24 September 2026

—— 'Documentation' (*Space-Track.org*) <https://www.space-track.org/documentation> accessed 24 September 2026

—— 'ESA Spacecraft Dodges Large Constellation' (*European Space Agency*, 3 September 2019) <https://www.esa.int/Space_Safety/ESA_spacecraft_dodges_large_constellation> accessed 24 September 2026

—— 'Frequently Asked Questions (FAQs)' (*NASA Conjunction Assessment Risk Analysis*) <https://www.nasa.gov/cara/frequently-asked-questions/> accessed 24 September 2026

—— 'Online Index of Objects Launched into Outer Space' (*United Nations Office for Outer Space Affairs*) <https://www.unoosa.org/oosa/osoindex/index.jspx> accessed 24 September 2026

—— 'SATCAT Format Documentation' (*CelesTrak*) <https://celestrak.org/satcat/satcat-format.php> accessed 24 September 2026

—— 'United Nations Register of Objects Launched into Outer Space' (*United Nations Office for Outer Space Affairs*) <https://www.unoosa.org/oosa/en/spaceobjectregister/index.html> accessed 24 September 2026

—— 'What Is Jonathan McDowell's GCAT, and Why Is It Important?' (*New Space Economy*, 10 March 2026) <https://newspaceeconomy.ca/2026/03/10/jonathan-mcdowells-gcat-and-why-it-matters/> accessed 24 September 2026

Benthall S and Strandburg KJ, 'Agent-Based Modeling as a Legal Theory Tool' (2021) 9 Frontiers in Physics 666386

Boyle A, 'SpaceX Reports a "Bug" in Its Alert System after ESA Shifts Spacecraft to Avoid Starlink Satellite Collision' (*GeekWire*, 3 September 2019) <https://www.geekwire.com/2019/esa-shifts-spacecraft-avoid-starlink-satellite-spacex-reports-bug-collision-warning-system/> accessed 24 September 2026

Coldewey D, 'Near Miss between Science Craft and Starlink Satellite Shows Need to Improve Orbital Coordination' (*TechCrunch*, 3 September 2019) <https://techcrunch.com/2019/09/03/near-miss-between-science-craft-and-starlink-satellite-shows-need-to-improve-orbital-coordination/> accessed 24 September 2026

Constant C, Bhattarai S and Ziebart M, 'Limitations of Current Practices in Uncooperative Space Surveillance: Analysis of Mega-Constellation Data Time-Series' (Advanced Maui Optical and Space Surveillance Technologies Conference, Maui, 2023) <https://amostech.com/TechnicalPapers/2023/Poster/Constant.pdf> accessed 24 September 2026

Jakhu RS, Jasani B and McDowell JC, 'Critical Issues Related to Registration of Space Objects and Transparency of Space Activities' (2018) 143 Acta Astronautica 406

Jee C, 'One of SpaceX's Starlink Satellites Almost Collided with a Weather Satellite' (*MIT Technology Review*, 2 September 2019) <https://www.technologyreview.com/2019/09/02/133180/one-of-spacexs-starlink-satellites-almost-collided-with-a-weather-forecasting-satellite/> accessed 24 September 2026

Kelso TS, 'Current GP Element Sets' (*CelesTrak*) <https://celestrak.org/NORAD/elements/> accessed 24 September 2026

McAdams RH and Ulen TS, 'Introduction' [2002] U Ill L Rev 791

McDowell JC, 'GCAT: General Catalog of Artificial Space Objects' (*Jonathan's Space Report*) <https://planet4589.org/space/gcat/> accessed 24 September 2026

—— 'Payload Catalog Column Descriptions' (*Jonathan's Space Report*) <https://planet4589.org/space/gcat/web/cat/pcols.html> accessed 24 September 2026

Picker RC, 'SimLaw 2011' [2002] U Ill L Rev 1019

Rodrigues N, 'Registration of Space Objects: Requirements and Procedures' (KiboCUBE Regulatory Webinar, 11 September 2023) <https://www.unoosa.org/documents/pdf/Access2Space4All/KiboCUBE/RegulatoryWebinar/KiboCUBE_Regulatory_Webinar_Registration_of_Space_Objects_Rodrigues.pdf> accessed 24 September 2026

Smith M, 'ESA Urges Automated Satellite Collision Avoidance Systems After Aeolus/Starlink Maneuver' (*SpacePolicyOnline.com*, 3 September 2019) <https://spacepolicyonline.com/news/esa-urges-automated-satellite-collision-avoidance-systems-after-aeolus-starlink-maneuver/> accessed 24 September 2026

Vestoso M and Cecere I, 'Exploring the Intersections between Law, ABM and Policy-Making: On the Clash between Formal and Informal Norms' (1st Workshop on Agent-based Modeling and Policy-Making (AMPM 2021), Vilnius, 8 December 2021), CEUR Workshop Proceedings vol 3182 <https://ceur-ws.org/Vol-3182/paper16.pdf> accessed 24 September 2026

Wall M, 'European Satellite Dodges Potential Collision with SpaceX Starlink Craft' (*Space.com*, 3 September 2019) <https://www.space.com/spacex-starlink-esa-satellite-collision-avoidance.html> accessed 24 September 2026

Wright Nelson J, 'Lost in Space? Gaps in the International Space Object Registration Regime' (*EJIL: Talk!*, 19 November 2018) <https://www.ejiltalk.org/lost-in-space-gaps-in-the-international-space-object-registration-regime/> accessed 24 September 2026
