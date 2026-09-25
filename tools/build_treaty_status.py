#!/usr/bin/env python3
"""Build site/data/treaty_status.json from the UNOOSA status document.

Source (and the only source): UNOOSA, 'Status of International Agreements
relating to activities in outer space as at 1 January 2026',
UN Doc A/AC.105/C.2/2026/CRP.9/Rev.1 (17 April 2026). Nothing is inferred
from any other source. Run by hand when a new edition is published:

    python3 tools/build_treaty_status.py path/to/AC105_C2_2026_CRP09Rev01E.pdf

The table is parsed by word position (requires PyMuPDF). The parse is checked
against the document's own 'Total' row; any difference is reported in the
output file rather than corrected.
"""
import json, re, sys
from pathlib import Path
import pymupdf

SOURCE = {
    "symbol": "A/AC.105/C.2/2026/CRP.9/Rev.1",
    "title": "Status of International Agreements relating to activities in outer space as at 1 January 2026",
    "as_at": "2026-01-01",
    "issued": "2026-04-17",
    "url": "https://www.unoosa.org/unoosa/uploads/res/oosadoc/data/documents/2026/aac_105c_22026crp/aac_105c_22026crp_9rev_1_0_html/AC105_C2_2026_CRP09Rev01E.pdf",
}
COLS = ['OST', 'ARRA', 'LIAB', 'REG', 'MOON', 'NTB', 'BRS', 'ITSO', 'INTR', 'ESA', 'ARB', 'INTC', 'IMSO', 'EUTL', 'EUM', 'ITU']
KEEP = ('OST', 'LIAB', 'REG')
MARK = {'R': 'party', 'S': 'signatory', 'D': 'declaration'}

# SATCAT owner code -> row name(s) in the UNOOSA table. Codes are those of the
# CelesTrak SATCAT (celestrak.org/satcat/sources.php). Codes for companies,
# organisations not in the table, and territories not listed are mapped to [].
CODE_TO_ROWS = {
    'US': ['United States of America'], 'CIS': ['Russian Federation'], 'PRC': ['China'],
    'UK': ['United Kingdom of Great Britain and Northern Ireland'], 'FR': ['France'], 'JPN': ['Japan'],
    'IND': ['India'], 'GER': ['Germany'], 'IT': ['Italy'], 'CA': ['Canada'], 'SKOR': ['Republic of Korea'],
    'SPN': ['Spain'], 'TURK': ['Türkiye'], 'AUS': ['Australia'], 'ARGN': ['Argentina'], 'FIN': ['Finland'],
    'NOR': ['Norway'], 'ISRA': ['Israel'], 'BRAZ': ['Brazil'], 'UAE': ['United Arab Emirates'],
    'INDO': ['Indonesia'], 'SING': ['Singapore'], 'GREC': ['Greece'], 'SAUD': ['Saudi Arabia'],
    'IRAN': ['Iran (Islamic Republic of)'], 'POL': ['Poland'], 'EGYP': ['Egypt'], 'SWED': ['Sweden'],
    'THAI': ['Thailand'], 'MALA': ['Malaysia'], 'LUXE': ['Luxembourg'], 'PAKI': ['Pakistan'],
    'MEX': ['Mexico'], 'NETH': ['Netherlands (Kingdom of the)'], 'POR': ['Portugal'], 'BEL': ['Belgium'],
    'DEN': ['Denmark'], 'ALG': ['Algeria'], 'SWTZ': ['Switzerland'], 'CZCH': ['Czechia'], 'RWA': ['Rwanda'],
    'UKR': ['Ukraine'], 'KAZ': ['Kazakhstan'], 'BUL': ['Bulgaria'], 'NIG': ['Nigeria'], 'CHLE': ['Chile'],
    'VTNM': ['Viet Nam'], 'AZER': ['Azerbaijan'], 'BELA': ['Belarus'], 'MA': ['Morocco'], 'HUN': ['Hungary'],
    'RP': ['Philippines'], 'SAFR': ['South Africa'], 'VENZ': ['Venezuela (Bolivarian Republic of)'],
    'ASRA': ['Austria'], 'ECU': ['Ecuador'], 'PERU': ['Peru'], 'ANG': ['Angola'], 'SVN': ['Slovenia'],
    'LTU': ['Lithuania'], 'KWT': ['Kuwait'], 'NKOR': ['Democratic People’s Republic of Korea'],
    'SVK': ['Slovakia'], 'COL': ['Colombia'], 'EST': ['Estonia'], 'BOL': ['Bolivia (Plurinational State of)'],
    'URY': ['Uruguay'], 'IRAQ': ['Iraq'], 'LAOS': ['Lao People’s Democratic Republic'], 'BGD': ['Bangladesh'],
    'JOR': ['Jordan'], 'ETH': ['Ethiopia'], 'HRV': ['Croatia'], 'DJI': ['Djibouti'], 'BWA': ['Botswana'],
    'BHR': ['Bahrain'], 'SLB': ['Solomon Islands'], 'NZ': ['New Zealand'], 'MNE': ['Montenegro'],
    'ROM': ['Romania'], 'IRE': ['Ireland'], 'LVA': ['Latvia'],
    # joint programmes: each State shown separately
    'CHBZ': ['China', 'Brazil'], 'FGER': ['France', 'Germany'], 'FRIT': ['France', 'Italy'],
    'USBZ': ['United States of America', 'Brazil'], 'GRSA': ['Greece', 'Saudi Arabia'],
    'TMMC': ['Turkmenistan', 'Monaco'], 'STCT': ['Singapore'],
    # intergovernmental organisations with declarations in the table
    'ESA': ['European Space Agency'],
    'EUME': ['European Organization for the Exploitation of Meteorological Satellites'],
    'EUTE': ['European Telecommunications Satellite Organization'],
}
IGO = {'ESA', 'EUME', 'EUTE'}
NOTES = {
    'CIS': 'SATCAT code CIS (former USSR) is shown against the Russian Federation, the continuator State of the USSR.',
    'ROC': 'Taiwan is not listed in the UNOOSA status table.',
    'STCT': 'Joint Singapore/Taiwan code; Taiwan is not listed in the UNOOSA status table.',
}


def parse(pdf):
    d = pymupdf.open(pdf)
    rows = []
    for page in d:
        W = page.get_text('words')
        ostw = [w for w in W if w[4] == 'OST']
        if not ostw:
            continue
        hy0 = ostw[0][3]
        hdr = {}
        for w in W:
            if w[4] in COLS and w[4] not in hdr and abs(w[3] - hy0) < 3:
                hdr[w[4]] = (w[0] + w[2]) / 2
        cx = sorted((x, k) for k, x in hdr.items())
        firstcol = cx[0][0]
        chars = []
        for b in page.get_text('rawdict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    for ch in s['chars']:
                        chars.append((ch['c'], ch['bbox'], s['size']))
        name = [c for c in chars if c[1][3] > hy0 + 4 and c[1][2] < firstcol - 8 and c[2] > 7.5
                and c[1][1] < page.rect.height - 45]
        lines = {}
        for c in name:
            lines.setdefault(round(c[1][3], 1), []).append(c)
        groups = []
        for y in sorted(lines):
            cs = sorted(lines[y], key=lambda c: c[1][0])
            t, px = '', None
            for c in cs:
                if px is not None and c[1][0] - px > 1.5 and not t.endswith(' '):
                    t += ' '
                if c[0] != ' ' or not t.endswith(' '):
                    t += c[0]
                px = c[1][2]
            txt = re.sub(r'\s+', ' ', t).strip()
            if not txt or re.fullmatch(r'[\d\s/]+', txt) or 'V.26' in txt:
                continue
            if groups and y - groups[-1]['ys'][-1] < 9.45:  # wrapped name (row pitch is 9.72pt)
                groups[-1]['ys'].append(y); groups[-1]['txt'].append(txt)
            else:
                groups.append({'ys': [y], 'txt': [txt], 'marks': {}, 'nums': {}})
        for w in W:
            if w[3] <= hy0 + 2 or w[0] < firstcol - 15:
                continue
            tok = w[4]
            if tok not in ('R', 'S', 'D') and not re.fullmatch(r'\d+', tok):
                continue
            my, mx = w[3], (w[0] + w[2]) / 2
            g = min(groups, key=lambda g: 0 if g['ys'][0] - 2 <= my <= g['ys'][-1] + 2 else min(abs(my - y) for y in g['ys']))
            col = min(cx, key=lambda c: abs(c[0] - mx))[1]
            g['marks' if tok in 'RSD' else 'nums'][col] = tok
        for g in groups:
            rows.append((' '.join(g['txt']), g['marks'], g['nums']))
    return rows


def main(pdf):
    rows = parse(pdf)
    table = {n: m for n, m, _ in rows if m and not n.startswith('Total')}
    totals = {n.split(' ')[1]: {c: int(v) for c, v in nums.items()} for n, _, nums in rows if n.startswith('Total')}
    check = {}
    for mk in ('R', 'S', 'D'):
        for c in KEEP:
            got = sum(1 for m in table.values() if m.get(c) == mk)
            doc = totals.get(mk, {}).get(c, 0)
            if got != doc:
                check[f'{c} {mk}'] = {'table_rows': got, 'document_total_row': doc}
    status = {}
    for code, names in CODE_TO_ROWS.items():
        ent = []
        for n in names:
            if n not in table:
                sys.exit(f'row not found in the status table: {n!r} (code {code})')
            m = table[n]
            blank = 'no entry' if code in IGO else 'neither'
            ent.append({'name': n, **{c: MARK.get(m.get(c), blank) for c in KEEP}})
        status[code] = ent
    out = {'source': SOURCE, 'treaties': {'OST': 'Outer Space Treaty (1967)', 'LIAB': 'Liability Convention (1972)',
                                          'REG': 'Registration Convention (1975)'},
           'legend': {'party': 'R — ratification, acceptance, approval, accession or succession',
                      'signatory': 'S — signature only', 'declaration': 'D — declaration of acceptance of rights and obligations (intergovernmental organisation)',
                      'neither': 'no entry in the table', 'no entry': 'no entry in the table (intergovernmental organisation)'},
           'table_vs_total_row': check, 'notes': NOTES, 'igo_codes': sorted(IGO), 'status': status}
    dst = Path(__file__).resolve().parents[1] / 'site' / 'data' / 'treaty_status.json'
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f'wrote {dst} — {len(status)} owner codes; table rows {len(table)}; discrepancies vs total row: {check or "none"}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'AC105_C2_2026_CRP09Rev01E.pdf')
