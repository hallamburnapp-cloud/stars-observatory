#!/usr/bin/env node
// ============================================================
// STARS Observatory — automated QA gate.
//
// Runs in CI (refresh.yml) after the data pipeline and BEFORE the
// Pages artifact is uploaded: a failure here blocks the deploy.
//
// Checks:
//   1. Citation integrity — the rendered OSCOLA footnote and
//      bibliography forms must match the canonical templates
//      character-for-character, built ONLY from CITATION.cff,
//      site/data/citation.json and the loaded dataset. No URL and
//      no access date may appear in either form.
//   2. Pickability — every rendered object must be selectable via
//      the real pointer pick path (incl. the dense-cluster chooser)
//      and must produce a detail card with its NORAD number.
//   3. Legend footnote — the rocket-body exclusion count shown in
//      the legend must equal catalog R/B minus rendered R/B.
//   4. Time controls — speed changes must never start playback.
//   5. Permalinks — random ?sat= deep links must select the object.
//   6. Console hygiene — no page errors during the run.
//
// Usage: node tests/run_qa.mjs [--quick]
//   --quick samples ~500 objects instead of the full catalog
//           (local smoke runs; CI always runs the full sweep).
// ============================================================
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const QUICK = process.argv.includes('--quick');
const PORT = 8931;

let failures = [];
let passes = 0;
function check(ok, label, detail = '') {
  if (ok) { passes++; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ' — ' + detail : ''}`); console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ---------- static file server (no deps) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(SITE, p));
  if (!f.startsWith(SITE) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// ---------- canonical expectations, computed in Node ----------
const cff = readFileSync(join(ROOT, 'CITATION.cff'), 'utf8');
const cffVersion = (cff.match(/^version:\s*["']?([0-9A-Za-z.\-]+)/m) || [])[1];
if (!cffVersion) { console.error('FATAL: no version in CITATION.cff'); process.exit(1); }
const citation = JSON.parse(readFileSync(join(SITE, 'data', 'citation.json'), 'utf8'));
const sats = JSON.parse(readFileSync(join(SITE, 'data', 'sats.json'), 'utf8'));
const loadedSnapshotISO = String(sats.generated).slice(0, 10);

function oscolaDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}
// Templates from the spec — the single source of truth for this test.
const expFoot = `Hallam Burnapp, 'STARS Observatory' (version ${citation.version}, data snapshot ${oscolaDate(loadedSnapshotISO)}, University of Aberdeen ${citation.publisher_year}) DOI: ${citation.version_doi}.`;
const expBib = `Burnapp H, 'STARS Observatory' (version ${citation.version}, data snapshot ${oscolaDate(loadedSnapshotISO)}, University of Aberdeen ${citation.publisher_year}) DOI: ${citation.version_doi}`;

console.log(`\nQA gate — version ${cffVersion}, snapshot ${loadedSnapshotISO}${QUICK ? ' (quick mode)' : ''}\n`);

// ---------- browser ----------
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

async function loadApp(url) {
  await page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.querySelector('#loader');
    return l && getComputedStyle(l).display === 'none';
  }, { timeout: 180000 });
}
await loadApp(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__QA && __QA.eligible().length > 0, { timeout: 60000 });

// ---------- 1. citation integrity ----------
console.log('[1] Citation integrity');
await page.click('.tabbar button[data-panel="prov"]'); // open Panel 04 so the block is interactable
await page.waitForSelector('#citeOscola', { state: 'visible', timeout: 15000 });
check(citation.version === cffVersion, 'citation.json version equals CITATION.cff version', `${citation.version} vs ${cffVersion}`);
const gotFoot = (await page.textContent('#citeOscola')).trim();
check(gotFoot === expFoot, 'default rendered form is the footnote template, character-for-character', `\n    expected: ${expFoot}\n    got:      ${gotFoot}`);
await page.click('#csBib');
const gotBib = (await page.textContent('#citeOscola')).trim();
check(gotBib === expBib, 'bibliography form matches template, character-for-character', `\n    expected: ${expBib}\n    got:      ${gotBib}`);
check(!gotBib.endsWith('.'), 'bibliography form has no trailing full stop');
for (const [name, s] of [['footnote', gotFoot], ['bibliography', gotBib]]) {
  check(!/https?:\/\/|<http|\baccessed\b/i.test(s), `${name} form contains no URL and no access date`);
  check(s.includes(`data snapshot ${oscolaDate(loadedSnapshotISO)}`), `${name} snapshot date equals the loaded dataset date`);
}
await page.click('#csFoot'); // restore default
const bibtex = (await page.textContent('#citeBibtex')).trim();
await page.click('#drawerClose').catch(() => page.keyboard.press('Escape'));
check(bibtex.includes(`version   = {${citation.version}}`) || bibtex.includes(`version = {${citation.version}}`) || bibtex.includes(`version={${citation.version}}`) || new RegExp(`version\\s*=\\s*\\{${citation.version.replace(/\./g, '\\.')}\\}`).test(bibtex), 'BibTeX carries the CITATION.cff version');
check(new RegExp(`date-released\\s*=\\s*\\{${citation.date_released}\\}`).test(bibtex), 'BibTeX date-released is the CITATION.cff ISO date');
check(/license\s*=\s*\{MIT\}/.test(bibtex), 'BibTeX license is MIT');
check(bibtex.includes(citation.version_doi), 'BibTeX DOI is the version DOI');
check(bibtex.includes(loadedSnapshotISO), 'BibTeX note carries the loaded snapshot date');
const footDoi = (await page.textContent('#footDoiVal')).trim();
check(footDoi === citation.version_doi, 'footer shows the version DOI', footDoi);
const footCopy = (await page.textContent('#foot')).trim();
check(footCopy.includes('© 2026 Hallam Burnapp. All rights reserved.'), 'footer carries the copyright line');
const warnHidden = await page.$eval('#citeWarn', el => el.hidden || getComputedStyle(el).display === 'none');
check(citation.snapshot_date === loadedSnapshotISO ? warnHidden : !warnHidden, 'snapshot mismatch warning correctly ' + (citation.snapshot_date === loadedSnapshotISO ? 'hidden' : 'shown'));

// ---------- 2. time controls ----------
console.log('[2] Time controls');
const playingAtLoad = await page.evaluate(() => __QA.playing());
await page.evaluate(() => __QA.pause());
await page.click('.timebar [data-speed="600"]');
check(!(await page.evaluate(() => __QA.playing())), 'speed change while paused stays paused');
const pressed = await page.getAttribute('#tPlay', 'aria-pressed');
check(pressed === 'false', 'play button reflects paused state after speed change', `aria-pressed=${pressed}`);
await page.click('.timebar [data-speed="60"]');
check(!(await page.evaluate(() => __QA.playing())), 'second speed change still does not start playback');
check(playingAtLoad === true, 'app starts in playing state (baseline)');

// ---------- 3. legend footnote ----------
console.log('[3] Legend exclusion footnote');
const rb = await page.evaluate(() => __QA.legendRB());
const note = (await page.textContent('.legend-note').catch(() => '')) || '';
const noteNums = (note.match(/[\d,]+/g) || []).map(s => parseInt(s.replace(/,/g, ''), 10));
check(noteNums[0] === rb.noGP && noteNums[1] === rb.catalogRB, 'legend footnote figures equal catalog R/B minus rendered R/B', `note says ${noteNums[0]}/${noteNums[1]}, computed ${rb.noGP}/${rb.catalogRB}`);

// ---------- 4. pick every rendered object ----------
console.log('[4] Pickability sweep');
const eligible = await page.evaluate(() => __QA.eligible());
const idxs = QUICK ? eligible.filter((_, k) => k % Math.ceil(eligible.length / 500) === 0) : eligible;
console.log(`  rendered objects: ${eligible.length}${QUICK ? `, sampling ${idxs.length}` : ''}`);
let chooserCount = 0, direct = 0;
const failedPicks = [];
const BATCH = 1500;
for (let off = 0; off < idxs.length; off += BATCH) {
  const batch = idxs.slice(off, off + BATCH);
  const res = await page.evaluate((list) => {
    // Retries vary distance AND viewing angle: a co-radial neighbour can sit
    // exactly in front of the target from one angle but not another — exactly
    // what a human does by rotating the globe.
    // low df = zoomed close; non-zero off = click a few px away (chooser path).
    // Offset attempts vary direction and angle because a third object can sit
    // on any single offset point — some catalog entries are EXACT duplicates
    // (two NORAD ids propagating to the same position), reachable only via
    // the chooser.
    const ATTEMPTS = [[1.35, 0, 0], [1.15, 4, 0], [1.02, 0, 0], [1.02, 9, 0], [1.8, -7, 0],
                      [1.35, 0, 8], [1.02, 0, 8], [1.02, 0, -8], [1.35, 21, -8],
                      [1.02, 45, 10], [1.6, -18, 8], [1.02, 63, -11]];
    const out = [];
    for (const i of list) {
      let r;
      for (const [df, tilt, off] of ATTEMPTS) { r = __QA.pickTest(i, df, tilt, off); if (r.ok) break; }
      out.push({ i, ok: r.ok, mode: r.mode, why: r.why, norad: __QA.norad(i) });
    }
    return out;
  }, batch);
  for (const r of res) {
    if (r.ok) { if (r.mode === 'chooser') chooserCount++; else direct++; }
    else failedPicks.push(r);
  }
  process.stdout.write(`  …${Math.min(off + BATCH, idxs.length)}/${idxs.length} (direct ${direct}, chooser ${chooserCount}, failed ${failedPicks.length})\r`);
}
console.log('');
check(failedPicks.length === 0, `every rendered object is pickable with a matching detail card (${direct + chooserCount}/${idxs.length})`,
  failedPicks.length ? `unpickable NORAD IDs: ${failedPicks.slice(0, 25).map(f => `${f.norad}(${f.why})`).join(', ')}${failedPicks.length > 25 ? ` …and ${failedPicks.length - 25} more` : ''}` : '');
if (chooserCount > 0) console.log(`  (${chooserCount} sweep picks resolved via the chooser)`);
// Dedicated dense-cluster chooser test: click between two overlapping objects,
// assert the chooser opens, lists them, and resolves the pick correctly.
let chooser = { ok: false, why: 'not-run' };
for (let attempt = 0; attempt < 5 && !chooser.ok; attempt++) {
  chooser = await page.evaluate((s) => __QA.chooserTest(s), attempt);
}
check(chooser.ok, `dense-cluster chooser opens, lists the pair, and resolves the pick (${chooser.rows || 0} rows)`, chooser.why || '');

// ---------- 4b. real pointer events & filter pickability ----------
// The sweep above uses the synthetic pick path; this section drives REAL
// mouse events end-to-end, including the case a user actually hit: with a
// filter active, the dimmed (filtered-out) dots must still open their card.
console.log('[4b] Real pointer events & filters');
await page.evaluate(() => __QA.pause());
async function realClick(idx) {
  const s = await page.evaluate(i => __QA.aimAt(i, 1.02), idx);
  if (!s || s.z > 1) return { ok: false, why: 'offscreen' };
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(130);
  if (await page.evaluate(() => __QA.chooserOpen())) {
    if (!(await page.evaluate(i => __QA.chooserPick(i), idx))) return { ok: false, why: 'chooser-missing' };
    await page.waitForTimeout(80);
  }
  const rows = await page.evaluate(() => __QA.detailNorad());
  const norad = await page.evaluate(i => __QA.norad(i), idx);
  return rows.includes(norad) ? { ok: true } : { ok: false, why: 'card-mismatch' };
}
// (a) unfiltered: isolated rendered objects must respond to real clicks
// (dense clusters are covered by the dedicated chooser test above).
const rcPool = await page.evaluate(() => {
  const el = __QA.eligible(); const out = [];
  for (let k = 0; k < 150; k++) out.push(el[Math.floor(Math.random() * el.length)]);
  return out;
});
let rcPass = 0, rcTried = 0; const rcFails = [];
for (const idx of rcPool) {
  if (rcTried >= 8) break;
  const s = await page.evaluate(i => __QA.aimAt(i, 1.02), idx);
  if (!s || s.crowd > 0) continue;
  rcTried++;
  const r = await realClick(idx);
  if (r.ok) rcPass++; else rcFails.push(`${await page.evaluate(i => __QA.norad(i), idx)}(${r.why})`);
}
check(rcTried >= 4 && rcPass === rcTried, `real mouse clicks select isolated objects (${rcPass}/${rcTried})`, rcFails.join(', '));
// (b) with the Debris type filter active, dimmed payloads/rocket bodies must STILL be clickable
await page.selectOption('#fType', 'DEB');
await page.waitForTimeout(250);
const dimPool = await page.evaluate(() => {
  const out = [];
  for (const i of __QA.aliveAll()) if (__QA.filteredOut(i)) out.push(i);
  const step = Math.max(1, Math.floor(out.length / 150));
  return out.filter((_, k) => k % step === 0).slice(0, 150);
});
let dimPass = 0, dimTried = 0; const dimFails = [];
for (const idx of dimPool) {
  if (dimTried >= 6) break;
  const s = await page.evaluate(i => __QA.aimAt(i, 1.02), idx);
  if (!s || s.crowd > 0) continue;
  dimTried++;
  const r = await realClick(idx);
  if (r.ok) dimPass++; else dimFails.push(`${await page.evaluate(i => __QA.norad(i), idx)}(${r.why})`);
}
check(dimTried >= 3 && dimPass === dimTried, `dimmed filtered-out objects stay clickable while a filter is active (${dimPass}/${dimTried})`, dimFails.join(', '));
// (c) count consistency: the number beside every filter option / legend swatch
// must equal the propagated population it selects.
await page.selectOption('#fType', '');
await page.waitForTimeout(150);
const cc = await page.evaluate(() => {
  const d = __QA.datasetCounts();
  const top = Object.entries(d.byOwner).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { N: d.N, byType: d.byType, top, opts: top.map(([c]) => __QA.stateOption(c)), legend: __QA.legendRows() };
});
for (let k = 0; k < cc.top.length; k++) {
  const [code, n] = cc.top[k];
  const num = ((cc.opts[k] || '').match(/([\d,]+)\s*$/) || [])[1];
  check(num === n.toLocaleString('en-GB'), `state filter option ${code} shows its propagated count`, `option says ${num}, dataset has ${n.toLocaleString('en-GB')}`);
}
const payRow = cc.legend.find(r => r.startsWith('Payload')) || '';
const payNum = (payRow.match(/([\d,]+)/) || [])[1];
check(payNum === cc.byType['PAY'].toLocaleString('en-GB'), 'legend Payload count equals propagated payloads', `legend says ${payNum}, dataset has ${cc.byType['PAY'].toLocaleString('en-GB')}`);
// Selecting the top owner: the "objects shown" line must match its option's
// count (small tolerance: objects that decayed between the snapshot epoch and
// the run's wall-clock time render as absent).
await page.selectOption('#fState', cc.top[0][0]);
await page.waitForTimeout(250);
const shownVis = await page.evaluate(() => __QA.vis());
check(Math.abs(shownVis - cc.top[0][1]) / cc.top[0][1] < 0.04, `selecting ${cc.top[0][0]} shows its labelled count (±4% decay tolerance)`, `shown ${shownVis}, labelled ${cc.top[0][1]}`);
await page.selectOption('#fState', '');
await page.waitForTimeout(150);

// ---------- 4c. ground truth: click where the dot is DRAWN ----------
// Every check above aims with the app's own projection maths, so a bug in
// that maths (e.g. measuring from the window instead of the canvas, which sits
// below the top bar) passes them all while real users miss every dot. This
// section is independent of the app's projection: it recolours ONE dot,
// screenshot-diffs to find the pixel where it is really drawn, and then
// real-clicks/taps exactly there — resolving any chooser with a real click too.
console.log('[4c] Ground truth: real clicks on drawn dots');
async function groundTruth(pg, { touch = false, n = 10, cam = null, label = '' } = {}) {
  const vp = pg.viewportSize();
  await pg.evaluate(() => { __QA.pause(); const c = document.querySelector('#dClose'); if (c) c.click(); });
  await pg.evaluate(c => __QA.setCam(...c), cam || [6, 10, 36]); // default view unless given
  await pg.addStyleTag({ content: 'body.qa-gt *:not(html):not(body):not(#app):not(main):not(#scene){visibility:hidden!important;transition:none!important;animation:none!important}' });
  await pg.waitForTimeout(300);
  const lay = await pg.evaluate(() => { const c = document.querySelector('#scene').getBoundingClientRect(), h = document.querySelector('#scene').parentElement.getBoundingClientRect();
    return { dTop: Math.abs(c.top - h.top), dH: Math.abs(c.height - h.height), dW: Math.abs(c.width - h.width) }; });
  check(lay.dTop < 1 && lay.dH < 1 && lay.dW < 1, `${label}canvas exactly fills its host (not clipped under the top bar)`, JSON.stringify(lay));
  const shot = async () => (await pg.screenshot()).toString('base64');
  const drawnAt = (a, b) => pg.evaluate(async ([a, b]) => {
    const load = async s => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
      const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); };
    const A = await load(a), B = await load(b); let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      // count only pixels that turned towards the flash colour (magenta:
      // +R, -G, +B) so an unrelated change on the canvas (e.g. a late orbit
      // trail from an earlier selection) cannot pull the measurement
      const dr = B.data[i] - A.data[i], dg = B.data[i+1] - A.data[i+1], db = B.data[i+2] - A.data[i+2];
      if (dr - dg > 30 && db - dg > 30) { const p = i / 4; sx += p % A.width; sy += Math.floor(p / A.width); n++; }
    }
    return n ? { x: sx / n, y: sy / n, n } : null;
  }, [a, b]);
  const pool = await pg.evaluate(() => { const e = __QA.eligible(), o = []; for (let k = 0; k < 600; k++) o.push(e[Math.floor(Math.random() * e.length)]); return o; });
  let tried = 0, ok = 0, worstOff = 0, shots = 0; const fails = [];
  for (const idx of pool) {
    if (tried >= n || shots >= n * 3) break;
    const s = await pg.evaluate(i => __QA.screenOf(i), idx);
    if (s.z > 1 || s.x < 16 || s.x > vp.width - 16 || s.y < 16 || s.y > vp.height - 16) continue;
    if (!(await pg.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'scene', [s.x, s.y]))) continue; // under a panel
    if (await pg.evaluate(i => __QA.occluded(i), idx)) continue; // behind the Earth
    shots++;
    await pg.evaluate(() => document.body.classList.add('qa-gt')); await pg.waitForTimeout(120);
    const a = await shot();
    await pg.evaluate(i => __QA.flash(i, true), idx); await pg.waitForTimeout(100);
    const b = await shot();
    await pg.evaluate(i => __QA.flash(i, false), idx);
    await pg.evaluate(() => document.body.classList.remove('qa-gt')); await pg.waitForTimeout(80);
    const g = await drawnAt(a, b);
    if (!g) continue; // dot hidden behind the Earth or another object
    tried++;
    worstOff = Math.max(worstOff, Math.hypot(g.x - s.x, g.y - s.y));
    const tap = (x, y) => touch ? pg.touchscreen.tap(x, y) : pg.mouse.click(x, y);
    await tap(g.x, g.y); await pg.waitForTimeout(150);
    let sel = await pg.evaluate(() => __QA.selected);
    if (sel !== idx && await pg.evaluate(() => __QA.chooserOpen())) {
      const row = pg.locator(`#pickChooser .sr[data-i="${idx}"]`);
      if (await row.count()) {
        await row.scrollIntoViewIfNeeded(); const bb = await row.boundingBox();
        await tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.waitForTimeout(120);
        sel = await pg.evaluate(() => __QA.selected);
      }
    }
    const card = sel === idx && (await pg.evaluate(() => __QA.detailNorad())).includes(await pg.evaluate(i => __QA.norad(i), idx));
    if (card) ok++; else fails.push(`${await pg.evaluate(i => __QA.norad(i), idx)}→${sel}`);
    await pg.keyboard.press('Escape').catch(() => {});
    await pg.evaluate(() => { const c = document.querySelector('#dClose'); if (c) c.click(); });
    await pg.waitForTimeout(60);
  }
  check(tried >= Math.ceil(n / 2) && worstOff <= 3, `${label}app projection matches the drawn pixel (worst ${worstOff.toFixed(1)}px over ${tried} dots)`);
  check(tried >= Math.ceil(n / 2) && ok === tried, `${label}real ${touch ? 'taps' : 'clicks'} on drawn dots open that object's card (${ok}/${tried})`, fails.join(', '));
}
await groundTruth(page, { n: QUICK ? 8 : 16, label: 'desktop default view: ' });
await groundTruth(page, { n: QUICK ? 6 : 12, cam: [40, 60, 160], label: 'desktop zoomed out: ' });
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  phone.on('pageerror', e => pageErrors.push(String(e)));
  await phone.goto(`http://127.0.0.1:${PORT}/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await phone.waitForFunction(() => { const l = document.querySelector('#loader'); return l && getComputedStyle(l).display === 'none'; }, { timeout: 180000 });
  await phone.waitForFunction(() => window.__QA && __QA.eligible().length > 0, { timeout: 60000 });
  await groundTruth(phone, { touch: true, n: QUICK ? 6 : 12, label: 'phone (touch): ' });
  await ctx.close();
}

// ---------- 5. permalinks ----------
console.log('[5] Permalinks');
const alive = await page.evaluate(() => __QA.eligible().map(i => __QA.norad(i)));
for (let k = 0; k < 3; k++) {
  const norad = alive[Math.floor(Math.random() * alive.length)];
  await loadApp(`http://127.0.0.1:${PORT}/?sat=${norad}`);
  await page.waitForFunction(() => document.querySelector('#detail')?.classList.contains('show'), { timeout: 30000 }).catch(() => {});
  const shown = await page.$eval('#detail', el => el.classList.contains('show')).catch(() => false);
  const hasNorad = shown && (await page.textContent('#dRows')).includes(norad);
  check(shown && hasNorad, `?sat=${norad} permalink selects the object and shows its card`);
}

// ---------- 6. console hygiene ----------
console.log('[6] Console hygiene');
const realErrors = pageErrors.filter(e => !/favicon|swiftshader|GPU stall|WebGL.*fallback|Automatic fallback/i.test(e));
check(realErrors.length === 0, 'no page errors or console errors', realErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();

console.log(`\n${passes} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.error('\nQA GATE FAILED:\n' + failures.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('QA gate passed — deploy may proceed.');
