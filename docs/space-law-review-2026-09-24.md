# National space law review — 24 September 2026

Every entry in `site/data/national_law.json` (106 SATCAT owner codes) was re-checked against the UNOOSA National Space Law database, official legislation portals and gazettes, and national space agency/regulator sites. Each entry now carries `verified`, `source_check` and `evidence` fields.

**Classification rule applied** (as stated in the Art VI panel method note): `yes` = dedicated national legislation establishing an authorisation-and-supervision regime for non-governmental space activities (the Article VI OST function), in force; `no` = no such regime (agency-creation, registration-only, telecoms-only or draft regimes count as `no`); `consortium` = intergovernmental organisation, multi-State programme or commercial consortium code; `unknown` = cannot be determined.

`year` = year of the principal instrument named in `instrument`; null where none is named.

## Judgement calls for the author

These entries sit near the line of the rule above; the current value is shown first.

- **PRC — yes.** Rests on ministerial rules (2001 registration measures; 2002 interim measures on civil launch permits), not a statute. Strict reading of "legislation" → `no`.
- **GER — yes.** Satellite Data Security Act 2007 (SatDSiG) licenses only high-grade Earth-observation systems; the general space act is still a draft. Strict "comprehensive regime" reading → `no`.
- **CA — yes.** Remote Sensing Space Systems Act 2005 licenses only remote-sensing systems; Canadian Space Launch Act (Bill C-28) not enacted. Same question as GER.
- **ALG — yes.** Law 19-06 is a dedicated space law but makes space activities a State monopoly; there is no licensing of private operators.
- **PAKI — yes.** Pakistan Space Activities Rules 2024 (S.R.O. 60(I)/2024) establish licensing, but as secondary legislation under the National Command Authority Act 2010.
- **RWA — yes.** Law N° 022/2021 establishing the Rwanda Space Agency expressly empowers it to license space activities; a substantive space law is still being drafted.
- **NKOR — yes.** Law on Space Development (2013, revised 2022); no non-governmental actors to license. Source is a news report — no official text reachable.
- **RP, VENZ — now no** (were yes). Philippine Space Act 2019 and Venezuela's 2007 ABAE law create agencies and registries but no licensing power.
- **ARGN, SAUD — now no** (were yes). Argentina has decrees (CONAE, registry) only; Saudi Arabia's Space Law is still being drafted (2026 COPUOS statement).
- **Year for `no` entries** that name an agency or telecoms instrument carries that instrument's year (e.g. BELA 2004, BHR 2014); set to null if you prefer years only for space legislation.

## Watch list (pending legislation)

- **Switzerland** — Federal Act on Space Operations adopted by the National Council 24 Sept 2026 (191–0); Council of States vote pending → flip SWTZ to `yes` once passed and in force.
- **Germany** — draft Weltraumgesetz in inter-ministerial review.
- **Canada** — Bill C-28 (Canadian Space Launch Act) at second reading.
- **Japan** — Act No. 39 of 2026 amending the Space Activities Act; most provisions take effect by Cabinet Order within a year.
- **Sweden** — new Space Activities Act in consultation until 6 Nov 2026.
- **Estonia** — draft Space Act submitted to the Government Aug 2026. **Israel, Singapore, Thailand, Saudi Arabia, Hungary, Bahrain, Uruguay, Spain** — drafts in progress.

## Entry-by-entry changes

- **US** (United States). Replaced non-working Title 51 browse URL with 51 U.S.C. ch. 509 page; principal Art. VI licensing instrument set to Commercial Space Launch Act 1984 (NASA Act 1958 creates NASA, does not license private actors); year 1958->1984
- **CIS** (Russian Federation). Corrected instrument name (it is a Law of the RF adopted by Supreme Soviet decree No. 5663-1, not a 'Federal Law'); added date and 'as amended'. Note: UNOOSA English text is an unofficial translation of the original 1993 version
- **PRC** (China). Added the 2002 Interim Measures on permits for civil launch projects (the actual licensing instrument, still in force per CNSA 2025 notice); clarified no national Space Law enacted as of Sept 2026
- **UK** (United Kingdom). Corrected 'superseded in part': SIA 2018 did not supersede OSA 1986 but split scope (OSA now covers overseas activities); added 2021 Regulations and 2025 Indemnities Act amendment
- **JPN** (Japan). Added 2026 amendment (Act No. 39 of 2026, enacted 11 June, promulgated 17 June 2026; most provisions in force by Cabinet Order within one year) and Basic Space Act number. URL unchanged: Japanese Law Translation (Ministry of Justice) returns 403 to bots but is the canonical English text
- **FR** (France). Source switched from WIPO Lex (shows only 2013-amended version) to the Legifrance consolidated text (linked from UNOOSA; consolidated to Aug 2026). Legifrance returns 403 to curl but loaded via fetcher and works for humans; name normalised
- **IND** (India). Replaced law-firm (Chambers) source with official Indian Space Policy 2023 (ISRO/DoS); confirmed no Space Activities Act enacted as of Sept 2026; tightened wording
- **ITSO** (Intelsat (ITSO)). Updated for SES acquisition of Intelsat (July 2025); named constituent instrument and main licensing State; year null->1971 (ITSO Agreement); source from ITSO homepage to its About/Agreement page
- **ESA** (European Space Agency). Added Convention title/dates; year null->1975; source from generic 'Law at ESA' index to the ESA Convention page
- **IT** (Italy). Italy enacted its first comprehensive space-activities law (Law 89/2025, GU 24 June 2025, in force 25 June 2025); instrument and year 1983->2025 updated; removed erroneous 'Ratsiel'; source changed to Gazzetta Ufficiale
- **GER** (Germany). Rewrote editorial note concisely; confirmed Space Act still a draft as of 24 Sept 2026 (Bundestag debate); source moved from UNOOSA CRP to official federal law portal
- **GLOB** (Globalstar). Replaced company marketing page with SEC 10-Q (Q2 2026) official filing; added HQ and pending Amazon merger
- **CA** (Canada). Principal licensing instrument is RSSSA 2005 (the linked URL already pointed to it); CSA Act 1990 creates the agency but does not license private activities; year 1990->2005; noted pending Bill C-28
- **SES** (SES (Luxembourg)). Replaced company page with official Legilux ELI of the 2020 law (page needs JavaScript so bots see a stub; works in browsers); noted Intelsat acquisition
- **SKOR** (South Korea). Corrected second act's name to Space Liability Act and added its number (per UNOOSA); added 'as amended'. UNOOSA text is an unofficial translation of the 2005 version
- **EUTE** (Eutelsat). Corrected regulator: LOS authorisations are issued by the minister for space with CNES technical control, not ARCEP (frequencies only); added OneWeb/UK; year null->2008; source from company page to Legifrance LOS text
- **SPN** (Spain). Source changed to the BOE consolidated text of RD 278/1995; noted draft Space Activities Law (public consultation Nov 2025, not enacted)
- **ORB** (Orbcomm). Replaced generic FCC homepage with FCC Order and Authorization DA 08-633 (Orbcomm License Corp.), which records the 1994 licence; clarified licensing basis
- **AUS** (Australia). source_url pointed to the 2018 amending Act (C2018A00092); replaced with the principal Act's current compilation (C2004A00391, Act No. 123 of 1998 as renamed); instrument wording clarified
- **TURK** (Türkiye). Corrected decree number (No. 23, not 658); source now the official Mevzuat text of the decree; state display name updated to UN-recognised 'Türkiye'
- **ARGN** (Argentina). **yes → no.** law 'yes'->'no': Argentina has only agency-creation and registry decrees, no authorisation/licensing statute; LSC 2026 statement says a national regulation for authorisations is still in progress. Law No. 24061 claim removed (unverified); source now official record of Decree 125/1995
- **ROC** (Taiwan (Republic of China)). Added promulgation/entry-into-force dates and 2023 amendment
- **O3B** (O3b Networks). Replaced SES corporate page with UN registration record; added that the UK (not Luxembourg) is the registering State for O3b satellites
- **NOR** (Norway). Superseded instrument: the 1969 Act was repealed by the new Space Act (LOV-2025-12-22-128), in force 1 July 2026; year 1969->2025; source now Lovdata English translation
- **ISRA** (Israel). Updated status from 2021 to Israel's 2026 Legal Subcommittee statement (draft law in advanced formulation, not enacted); source replaced with the 2026 statement
- **BRAZ** (Brazil). Brazil enacted a general space activities law (Law 14.946/2024) covering authorisation, licensing and the Brazilian Space Registry; year 1994->2024; source now official Chamber of Deputies legislation record (planalto.gov.br copy also exists but was intermittently unavailable)
- **UAE** (United Arab Emirates). Principal instrument is now Decree-Law No. 46/2023 (legislation ID 2129 on the official portal is this decree-law, not the 2019 law); year 2019->2023; source changed from /download to the legislation's landing page (403 to bots, canonical official portal)
- **INDO** (Indonesia). Source replaced: generic UNOOSA overview PDF -> official JDIH (Ministry of Communication and Digital Affairs) record of the Law (loads via browser/WebFetch; blocks curl)
- **IM** (Inmarsat). Replaced irrelevant 2016 wireless telegraphy terminal-exemption regulations with UN registration record by the UK (Inmarsat-6 F2); instrument now names the Outer Space Act 1986
- **SING** (Singapore). Replaced law-firm source with Singapore's 2026 COPUOS Legal Subcommittee statement; noted NSAS established 1 April 2026
- **AB** (Arab Satellite Comm. Org. (Arabsat)). Replaced generic homepage with UNOOSA status-of-agreements document (A/AC.105/C.2/2025/CRP.9) listing the 1976 ARABSAT constituent agreement; year null->1976
- **GREC** (Greece). Instrument title completed; source updated to Greece's 14 Feb 2025 UNOOSA submission (supersedes 2021 version)
- **SAUD** (Saudi Arabia). **yes → no.** law 'yes'->'no', year 2022->null: no Space Law has been enacted; Saudi Arabia's 2026 LSC statement says a draft Space Law is being prepared, and CST's space regulations were still in public consultation to March 2026. Dead Istitlaa consultation link replaced with that official statement
- **EGYP** (Egypt). Instrument wording tightened (added telecom-law basis); law/year/source unchanged. No licensing competence found in Law 3/2018 competences; no space-activities law found as of Sept 2026. Source is a UNOOSA-hosted workshop presentation (no official Egyptian online text reachable).
- **POL** (Poland). **no → yes.** law no->yes; year 2014->2026; new instrument and source. Poland enacted its Act on Space Activities (Sejm 13 Feb 2026, published Dz.U. 3 Apr 2026, in force 14 days later).
- **EUME** (EUMETSAT). Replaced generic homepage with the EUMETSAT Convention text; named constituent instrument and its UN-convention declarations; year null->1983.
- **THAI** (Thailand). Status updated to 2025-2026 (still draft; Aug 2026 review ordered); source updated from 2024 to 2025 LSC statement.
- **MALA** (Malaysia). Source replaced (non-official Space Security Portal copy -> official MOSTI PDF); added gazettal/full-commencement dates.
- **LUXE** (Luxembourg). Added 2017 space resources law to instrument; law/year/source unchanged (Legilux page is JS-rendered; ELI record confirmed via data.legilux.public.lu as in force).
- **PAKI** (Pakistan). Source replaced: generic psarb.gov.pk homepage (403) -> Gazette of Pakistan (Extraordinary, 2 Feb 2024) text of the Rules, circulated by PARC (Govt of Pakistan); added S.R.O. number.
- **IRAN** (Iran). Instrument clarified: the ISA Statute (a Cabinet regulation) includes power to authorise space activities, but there is no dedicated space act. Source kept (unofficial translation published in J. Space Law); official Majlis Research Center page rc.majlis.ir unreachable (503) from here.
- **MEX** (Mexico). Source replaced (non-official newsletter -> Chamber of Deputies official text, still in force); instrument adds 2025 telecom law basis.
- **BEL** (Belgium). Instrument given full date and 2013 amendment and 2022 implementing Royal Decree; year/source unchanged.
- **DEN** (Denmark). Instrument given full date and current implementing order; amending bills (2020, L 77 of 2023) were not enacted (2023 bill withdrawn). Year/source unchanged.
- **NATO** (NATO). Replaced generic homepage with UNOOSA record of UK notification on NATO IVB decommissioning (shows UK as responsible State); instrument clarified.
- **AC** (Asia Satellite Telecommunications (AsiaSat)). Added Cap. 523 citation and year (null->1997) and State of registry (China, since 1998); source unchanged (OFCA licence issued under Cap. 523).
- **ABS** (ABS (Asia Broadcast Satellite)). Replaced generic company homepage with the official Bermuda Order 2006; noted Oct 2025 redomiciliation to Dubai (UAE), so Bermuda-only description was outdated.
- **ALG** (Algeria). Source replaced with the English text of the law from the Algerian Space Agency (ASAL); instrument adds date and notes Art. 5 State monopoly (no private licensing regime).
- **SWTZ** (Switzerland). Status updated: National Council (first chamber) adopted bill 24 Sept 2026; not yet enacted.
- **NETH** (Netherlands). Source switched from UNOOSA 2007 unofficial translation to official consolidated text (current version valid from 1 July 2025); instrument name standardised.
- **POR** (Portugal). Old URL used wrong DRE record ID (118484481; correct DL 16/2019 ID is 118275382). Replaced with official consolidated version; added 2024 amendment.
- **RWA** (Rwanda). **unknown → yes.** law unknown->yes, year null->2021, instrument named, source now official gazette text: RSA law expressly confers licensing/supervision powers (Art. 8(2)-(4)). Borderline: agency law only; UNIDIR notes a separate National Space Law is under development
- **CZCH** (Czech Republic). instrument updated to Sept 2026 status and regulatory route; source replaced (journal PDF download link -> UNIDIR Space Security Portal state page, reviewed Jan 2026); law 'no' confirmed
- **UKR** (Ukraine). law number corrected 503/96-VR -> 502/96-VR (503/96-VR is the Verkhovna Rada resolution bringing it into force); amendments noted
- **KAZ** (Kazakhstan). instrument wording expanded (date, official English title 'On Space Activity', as amended); URL kept - Adilet is a JavaScript app so bots see an empty shell, but it is the official legal portal and the page is indexed under this title
- **CHBZ** (China/Brazil (joint programme)). **unknown → consortium.** law unknown->consortium (joint bilateral programme code); source replaced (generic UNOOSA index -> UN registration record for CBERS-4A)
- **NIG** (Nigeria). instrument made precise (Act No., licensing section); source replaced (CRP compilation -> UNOOSA copy of Official Gazette No. 98, Vol. 97, 30 Aug 2010 with Act text)
- **BUL** (Bulgaria). instrument rewritten to state the regulatory position factually (removed note about unrelated Spatial Development Act); source replaced (generic UNOOSA index -> UNIDIR state page, reviewed July 2026)
- **VTNM** (Vietnam). instrument expanded with actual governing instruments; source replaced (academic PDF -> UNIDIR state page); no space law found in 2025-2026 legislative programmes
- **AZER** (Azerbaijan). instrument wording/date made precise; source replaced (CRP compilation -> Azercosmos official English translation of the Law; Azerbaijani original at e-qanun.az/framework/54853)
- **BELA** (Belarus). instrument clarified (date, 2011 amendment, NASB role); source replaced (CRP compilation -> UNOOSA English text of Decree 609)
- **MA** (Morocco). **unknown → no.** law unknown->no: no dedicated space law found in UNOOSA database, UNIDIR portal or national sources; source replaced (generic UNOOSA index -> UNIDIR state page, reviewed June 2025)
- **HUN** (Hungary). **unknown → no.** law unknown->no: no 2025 space act was adopted (only drafting announced 31 Mar 2025; still unadopted Oct 2025); source replaced (generic UNOOSA index -> UNIDIR state page, reviewed Feb 2026)
- **RP** (Philippines). **yes → no.** law yes->no under the dataset definition: RA 11363 has no authorisation or supervision provisions (only registry s.23, liability s.24, IP licensing s.8); year 2018->2019 (approved 8 Aug 2019); source -> PhilSA page with full Act text
- **CHLE** (Chile). instrument updated: Decree 338 advisory committee superseded; current framework is MinCiencia decrees and 2024 National Space Policy (published 22 Jul 2025); source -> official LeyChile record of Decree 30 (blocks bots, loads for humans)
- **SAFR** (South Africa). instrument: added 1995 amendment act currently in force
- **VENZ** (Venezuela). **yes → no.** law yes->no under the dataset definition: the ABAE law sets up the agency; its powers (Art. 5) cover policy and drafting technical norms, with no authorisation/licensing of operators; source replaced (academic PDF -> National Assembly record with gazette PDF)
- **ASRA** (Austria). instrument: full official title, BGBl reference and 2018 amendment added; source -> RIS consolidated version currently in force (previous RIS English-translation URL also works)
- **FGER** (France/Germany (joint)). **unknown → consortium.** law unknown->consortium (joint bilateral programme code); instrument names the Symphonie programme; removed claim that SatDSiG is a general licensing law (Germany still has no general space act; Weltraumgesetz only in draft); source -> UN registration record
- **STCT** (Singapore/Taiwan (joint)). **unknown → consortium.** law unknown->consortium (joint commercial SingTel/Chunghwa venture, not a single State); instrument names the objects and both States' position; source generic UNOOSA index -> Taiwan MOJ official text of the Space Development Act
- **RASC** (RascomStar-QAF). instrument rewritten to name the RASCOM Convention and operator; dropped unverified Dubai HQ claim; source generic rascomstar.com homepage -> RASCOM organisation page describing the Convention/Assembly of Parties
- **ECU** (Ecuador). IEE was 'Ecuadorian Space Institute' (not 'Civilian Space Agency') and was abolished in 2019; added Decree 714/2019 and Decree 143/2025; year 2012->2025; source -> text of Decree 714 (FAOLEX)
- **PERU** (Peru). added registry decree (2016) and declaratory spaceport Law 32571 (2026); law/year/source unchanged
- **FRIT** (France/Italy (joint)). **unknown → consortium.** law unknown->consortium (bilateral programme); named the objects, registering States and Italy's new Law 89/2025; source generic UNOOSA index -> CNES programme page
- **ANG** (Angola). **unknown → no.** law unknown->no (no space act found; only GGPEN agency decrees; UNOOSA database lists none); named decrees; source generic UNOOSA index -> Decree 152/21 record (unofficial legal database; official Diario da Republica is paywalled)
- **SVN** (Slovenia). added gazette ref and implementing decree; source COPUOS statement -> Official Gazette text of ZVDej
- **LTU** (Lithuania). instrument reworded (removed irrelevant 'spatial planning' note; states telecoms basis); source generic UNOOSA index -> e-seimas consolidated English text of Law on Electronic Communications
- **ISS** (International Space Station (multi-state programme)). instrument now uses the IGA's official title and notes element-by-element registration; law/year/source unchanged
- **SEAL** (Sea Launch (multinational consortium)). **unknown → consortium.** identified code as Sea Launch (SATCAT objects are Sea Launch Demo + Block DM-SL stages); state name updated; law unknown->consortium; source generic UNOOSA index -> FAA/AST record of FAA-licensed Sea Launch launches
- **NICO** (New ICO (ICO Global Communications)). **unknown → consortium.** identified code as New ICO (ICO F2); state name updated; law unknown->consortium (commercial entity); source generic UNOOSA index -> UN registration document
- **USBZ** (United States/Brazil (joint)). **unknown → consortium.** law unknown->consortium (joint US/Brazil commercial satellite); named object and registering State; source generic UNOOSA index -> Brazil's UN registration document
- **COL** (Colombia). added Decree 184/2023 amendment, ICT law basis and pending 2025 agency bill; source UNOOSA CRP -> official text of Decree 2442 (Bogota legal portal, shows amendment)
- **EST** (Estonia). updated status (draft submitted to Government Aug 2026; still not enacted); source 2024 ministry news -> official draft-law (EIS) dossier
- **BOL** (Bolivia). named the ABE creation decree (not merely 'administrative') and telecoms basis; year null->2010; source non-official newsletter -> Gaceta Oficial text of DS 0423 on ABE site
- **URY** (Uruguay). added status of 2022 agency bill and 2026 space policy bill; source non-official newsletter -> Presidency page on the agency bill
- **IRAQ** (Iraq). **unknown → no.** law unknown->no (no space act found; satellite matters under CMC telecoms regime); source generic UNOOSA index -> CMC space-services ground-station regulation
- **TMMC** (Turkmenistan/Monaco (joint)). **unknown → consortium.** law unknown->consortium (dual-State joint satellite code); named the arrangement, Turkmenistan's 2015 space law (includes licensing, Art. 17) and Monaco's draft-only status; year null->2015; replaced generic UNOOSA index with official Turkmen government record of the law
- **LAOS** (Laos). **unknown → no.** law unknown->no; named the actual satellite instrument (Decree 471/GOL of 27 Dec 2019) and year; replaced generic UNOOSA index with official Lao government page for the decree
- **BGD** (Bangladesh). replaced law-firm directory URL (lawzana.com) with the official Laws of Bangladesh text of the Telecommunication Act 2001 (Bengali; mentions satellite equipment); dropped unverified treaty-status claim; confirmed no space law/policy adopted as of Sept 2026
- **JOR** (Jordan). **unknown → no.** law unknown->no; named Telecommunications Law No. 13/1995 as the governing instrument; replaced generic UNOOSA index with WIPO Lex record of the law (TRC site has no stable law URL)
- **GRSA** (Greece/Saudi Arabia (joint)). **unknown → consortium.** law unknown->consortium (joint satellite code); identified the arrangement and that Greece registered it (ST/SG/SER.E/1044, 2022) under Law 4508/2017; removed claim that Saudi Arabia has an enacted 'Space Law' (it regulates via CST under Council of Ministers resolutions, no statute); year null->2017; source now the UN registration record
- **ETH** (Ethiopia). no substantive change (wording tightened); confirmed no space licensing proclamation enacted as of Sept 2026. Source is the official SSGI page; it is a JavaScript app that returns no text to bots but renders for humans
- **NKOR** (North Korea). corrected instrument to official name with adoption and 2022 revision dates; replaced Wikipedia URL with a news report of the 2022 revision (no reachable official DPRK or ROK law-database copy)
- **SVK** (Slovakia). completed truncated instrument name ('Act No. 378'); replaced COPUOS CRP PDF with official Slov-Lex record of the Act (English version on UNOOSA as evidence)
- **HRV** (Croatia). replaced vague note with the governing instrument (Electronic Communications Act 2022) and year; replaced generic UNOOSA index with the official gazette (Narodne novine) text; confirmed no space act as of Sept 2026
- **DJI** (Djibouti). year 2023->2022 (the principal instrument is the 2022 Law; the 2023 decree implements it); gave official English rendering with numbers; replaced generic UNOOSA index with the Journal Officiel page for the Law
- **BWA** (Botswana). **unknown → no.** law unknown->no; named the Communications Regulatory Authority Act 2012 and year; source is now BOCRA's copy of the Act, not the generic UNOOSA index; BOTSAT-1 (2025) launched without a space law
- **BHR** (Bahrain). **unknown → no.** law unknown->no; the Bahrain Space Agency's governance page (2026) says the National Space Law is still being developed; described the agency and spectrum arrangements; year null->2014 (agency decree); source now official BSA page
- **SLB** (Solomon Islands). **unknown → no.** law unknown->no; named the Telecommunications Act 2009 (TCSI satellite filing role) and year; source now the TCSI satellite filing page (the regulator), not the generic UNOOSA index
- **NZ** (New Zealand). added the Outer Space and High-altitude Activities Amendment Act 2025 (No 38, in force 29 July 2025) and the 2017 Regulations; URL kept (official NZ Legislation site; bot check returns 202/403 here, loads for humans)
- **MNE** (Montenegro). **unknown → no.** law unknown->no; named the Law on Electronic Communications (2024) and year; source now EKIP's (regulator's) legislation page; first satellite Luča (Dec 2025) launched without a space law
- **ROM** (Romania). **unknown → no.** law unknown->no (no licensing statute; only the registry mandate in Law 380/2022); year null->2022; source now the Official Gazette text hosted by ROSA (legislatie.just.ro record 263334 refused connections from this environment)

Entries with no change: TBD, FIN, SWED, KWT.
