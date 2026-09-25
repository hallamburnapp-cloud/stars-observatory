import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   STARS Observatory — main thread
   - loads sats.json / stats.json
   - spins up SGP4 worker for propagation
   - renders point cloud + textured Earth in Three.js
   ============================================================ */

const EARTH_R = 6371;          // km (mean)
const SCALE = 1 / 1000;        // scene units: 1 unit = 1000 km
const RE_SCENE = EARTH_R * SCALE;
// Support / donation link — set to a Ko-fi or GitHub Sponsors URL to enable
// the support UI (footer link + provenance-panel box). null = hidden.
const SUPPORT_URL = 'https://ko-fi.com/hallamburnapp';

// ---- palettes ----
const COL_TYPE = {
  'PAY': 0x4fd1e0,   // cyan
  'R/B': 0xffb454,   // amber
  'DEB': 0xff6b6b,   // red
  'UNK': 0x8a9bb5
};
// Article-VI top states (owner codes) + other
const STATE_COLORS = {
  'US':   0x4fd1e0,
  'CIS':  0xff6b6b,
  'PRC':  0xffb454,
  'UK':   0x55d18b,
  'JPN':  0xc792ea,
  'FR':   0x82aaff,
  'IND':  0xf78c6c,
  'ESA':  0xffcb6b,
  'OTHER':0x5d6b83
};
const REG_COLORS = { reg: 0x55d18b, unreg: 0xff6b6b, na: 0x44506a };
const CONST_COLORS = {
  'Starlink': 0x4fd1e0,
  'OneWeb':   0xffb454,
  'Qianfan':  0xff6b6b,
  'Guowang':  0xc792ea,
  'Kuiper':   0x55d18b,
  'other':    0x82aaff,
  'none':     0x3a4560
};

const state = {
  data: null, stats: null, lag: null,
  N: 0,
  // per-sat static arrays
  objType: null, ownerIdx: null, constIdx: null, registered: null,
  launchYear: null, name: null, norad: null, intl: null,
  regime: null, ok: null,
  ownerCode: null, ownerName: null,
  constLabel: null,
  // render
  colorMode: 'type',
  filters: { state: '', type: '', const: '', reg: '', regime: '' },
  // time
  simTime: Date.now(), speed: 1, playing: true, realAnchor: Date.now(), simAnchor: Date.now(),
  // buffers from worker
  lastPositions: null, lastAlive: null, lastGmst: 0, lastPropTime: 0,
  ready: false,
  scenarioTracks: null, scenarioActive: false
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Release version for asset cache-busting — read at runtime from the citation
// manifest (single source of truth: CITATION.cff via pipeline/build_citation.py).
// Never hardcode a version literal in this file.
function appVersion() { return (state.citation && state.citation.version) || 'dev'; }

// ---- Play/pause & speed: single source of truth --------------------------
// Every change to the main clock's play state or multiplier goes through these
// so the icon, aria state and chip highlight can never desynchronise.
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M6 4h4v16H6zM14 4h4v16h-4z';
function setPlaying(v) {
  state.playing = !!v;
  const pp = $('#playPath'); if (pp) pp.setAttribute('d', state.playing ? ICON_PAUSE : ICON_PLAY);
  const b = $('#tPlay'); if (b) b.setAttribute('aria-pressed', String(state.playing));
}
function setSpeed(v) {
  state.speed = v;
  $$('.timebar [data-speed]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.speed, 10) === v));
}

// Clipboard with a fallback for browsers/contexts where the async Clipboard
// API is unavailable (e.g. non-secure contexts, older WebKit).
function copyText(txt) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(txt).then(() => true).catch(() => _legacyCopy(txt));
  }
  return Promise.resolve(_legacyCopy(txt));
}
function _legacyCopy(txt) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}

// ============================================================
// 1. Load data
// ============================================================
async function loadData() {
  setLoad('Loading orbital catalogue…', 10);
  const [sats, stats, lag, citation, treaty] = await Promise.all([
    loadCatalog(),
    fetch('./data/stats.json', { cache: 'no-cache' }).then(r => r.json()),
    fetch('./data/lag.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
    fetch('./data/citation.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
    fetch('./data/treaty_status.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null)
  ]);
  state.data = sats; state.stats = stats; state.lag = lag;
  state.citation = citation; state.treaty = treaty;
  const arr = sats.sats;
  const N = arr.length;
  state.N = N;
  state.objType = new Array(N);
  state.ownerIdx = new Uint8Array(N);
  state.constIdx = new Uint8Array(N);
  state.registered = new Uint8Array(N);
  state.launchYear = new Array(N);
  state.name = new Array(N);
  state.norad = new Int32Array(N);
  state.intl = new Array(N);
  state.ownerCode = new Array(N);
  state.ownerName = new Array(N);
  state.constLabel = new Array(N);

  const tle1 = new Array(N), tle2 = new Array(N);
  for (let i = 0; i < N; i++) {
    const s = arr[i];
    state.norad[i] = s[0];
    state.name[i] = s[1];
    tle1[i] = alpha5(s[2]); tle2[i] = alpha5(s[3]);
    state.objType[i] = s[4];
    state.ownerIdx[i] = s[5];
    state.constIdx[i] = s[6];
    state.registered[i] = s[7];
    state.launchYear[i] = s[8];
    const owner = sats.owners[s[5]];
    state.ownerCode[i] = owner ? owner[0] : '?';
    state.ownerName[i] = owner ? owner[1] : 'Unknown';
    state.constLabel[i] = sats.constellations[s[6]] || '';
    // intl designator from TLE line 1 cols 10-17
    state.intl[i] = parseIntlDes(tle1[i]);
  }
  state.tle2 = tle2; // fixed-column copies (alpha5) for inclination / mean-motion reads
  setLoad('Parsing element sets…', 30);
  fillStats();
  return { tle1, tle2 };
}

// The catalog ships twice: sats.json (canonical, archived daily as the citable
// snapshot) and sats.pack.json, a lossless column-wise packing of the same
// records that is ~32% smaller over the wire (see pipeline/pack_sats.py).
// The page preloads the pack; sats.json is the fallback.
async function loadCatalog() {
  try {
    const r = await fetch('./data/sats.pack.json'); // default cache mode: matches the <link rel=preload>
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const p = await r.json();
    if (p.format !== 1) throw new Error('unknown pack format ' + p.format);
    state.catalogSource = 'pack';
    return unpackSats(p);
  } catch (e) {
    console.warn('sats.pack.json unavailable, loading sats.json:', e.message);
    state.catalogSource = 'json';
    return fetch('./data/sats.json', { cache: 'no-cache' }).then(r => r.json());
  }
}
// Mirrors unpack() in pipeline/pack_sats.py — keep the two in step.
const PACK_L1 = [62, 51, 36, 16, 1], PACK_L2 = [62, 52, 43, 35, 26, 17, 6, 1];
const PACK_TYPES = { P: 'PAY', D: 'DEB', R: 'R/B', U: 'UNK' };
function tleChecksum(line) {
  let sum = 0;
  for (let k = 0; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c >= 48 && c <= 57) sum += c - 48; else if (c === 45) sum += 1;
  }
  return String(sum % 10);
}
function unpackSats(p) {
  const widths = b => b.slice(0, -1).map((a, k) => a - b[k + 1]);
  const w1 = widths(PACK_L1), w2 = widths(PACK_L2);
  const cols = (arr, w, i) => { let t = ''; for (let c = 0; c < arr.length; c++) t += arr[c].substr(i * w[c], w[c]); return t; };
  const sats = new Array(p.n);
  let norad = 0;
  for (let i = 0; i < p.n; i++) {
    norad += p.noradDelta[i];
    let l1, l2;
    const raw = p.raw[i];
    if (raw) { l1 = raw[0]; l2 = raw[1]; }
    else {
      const sat = String(norad).padStart(+p.satw[i], '0');
      l1 = '1 ' + sat + cols(p.l1, w1, i); l1 += tleChecksum(l1);
      l2 = '2 ' + sat + cols(p.l2, w2, i); l2 += tleChecksum(l2);
    }
    const y = p.year.substr(i * 4, 4);
    sats[i] = [norad, p.name[i], l1, l2, PACK_TYPES[p.type[i]], p.owner[i], p.const[i], +p.reg[i], y === '    ' ? '' : y];
  }
  return { generated: p.generated, owners: p.owners, constellations: p.constellations, sats };
}

// Fill all [data-stat] elements from live data so the page stays
// consistent when the dataset is refreshed.
function fillStats() {
  const st = state.stats;
  const payTotal = (st.by_type && st.by_type.PAY) || 0;
  const usPay = (st.by_owner_payloads && st.by_owner_payloads.US) || 0;
  const starlink = Object.entries(st.constellations || {}).filter(([k]) => k.startsWith('Starlink')).reduce((a, [,v]) => a + v, 0);
  let regd = 0, unregd = 0;
  for (const v of Object.values(st.registration_by_owner || {})) { regd += v[0]; unregd += v[1]; }
  const totalOnorbit = st.total_onorbit || 0;
  const date = ((state.data && state.data.generated) || '').substring(0, 10);
  const vals = {
    date: date,
    totalOnorbit: totalOnorbit.toLocaleString('en-GB'),
    propagated: state.N.toLocaleString('en-GB'),
    noGP: (totalOnorbit - state.N).toLocaleString('en-GB'),
    payTotal: payTotal.toLocaleString('en-GB'),
    usPay: usPay.toLocaleString('en-GB'),
    usPct: payTotal ? Math.round(usPay / payTotal * 100) : 0,
    starlink: starlink.toLocaleString('en-GB'),
    unreg: unregd.toLocaleString('en-GB'),
    unregPct: (regd + unregd) ? Math.round(unregd / (regd + unregd) * 100) : 0
  };
  $$('[data-stat]').forEach(el => {
    const k = el.getAttribute('data-stat');
    if (vals[k] !== undefined) el.textContent = vals[k];
  });
}

// Catalogue numbers above 99,999 (issued since 11 July 2026) do not fit the
// TLE's five-character field. sats.json carries them in full, which shifts
// every later column by one and makes SGP4 parsing fail. For propagation only,
// re-encode them in the standard Alpha-5 form (A0000 = 100000, letters I and O
// skipped); sats.json and the CSV export keep the canonical records.
const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function alpha5(line) {
  if (!line || line.length !== 70) return line;
  const n = parseInt(line.substring(2, 8), 10);
  if (!(n >= 100000 && n <= 339999)) return line;
  const body = line.substring(0, 2) + ALPHA5[Math.floor(n / 10000) - 10] + String(n % 10000).padStart(4, '0') + line.substring(8, 69);
  return body + tleChecksum(body);
}

function parseIntlDes(tle1) {
  // columns 10-17 (1-indexed) => substring(9,17)
  const raw = (tle1 || '').substring(9, 17).trim();
  if (!raw) return '—';
  const yy = raw.substring(0, 2);
  const rest = raw.substring(2).trim();
  if (!yy || isNaN(parseInt(yy))) return '—';
  const yr = parseInt(yy) < 57 ? '20' + yy : '19' + yy;
  return yr + '-' + rest;
}

function setLoad(msg, pct, sub) {
  const st = $('#loadStatus'); if (st) st.textContent = msg;
  const bar = $('#loadBar'); if (bar) bar.style.width = pct + '%';
  if (sub) { const s = $('#loadSub'); if (s) s.textContent = sub; }
}

// ============================================================
// 2. Worker
// ============================================================
let worker, workerReady = false; // worker exists from boot; usable once 'ready'
// Spawned at the very start of boot so worker.js + satellite.js download and
// compile while the catalog is still in flight, not after it.
function spawnWorker() {
  // version from app.js's own (pipeline-stamped) URL: citation.json isn't loaded yet
  const v = new URL(import.meta.url).searchParams.get('v') || 'dev';
  if (!worker) worker = new Worker('./js/worker.js?v=' + v);
}
function startWorker(tle1, tle2) {
  return new Promise((resolve) => {
    spawnWorker();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        workerReady = true;
        state.regime = new Uint8Array(m.regimes);
        state.ok = new Uint8Array(m.ok);
        setLoad('Propagating positions (SGP4)…', 70);
        resolve();
      } else if (m.type === 'positions') {
        state.lastPositions = new Float32Array(m.positions);
        state.lastAlive = new Uint8Array(m.alive);
        state.lastGmst = m.gmst;
        state.lastPropTime = m.time;
        state.ready = true;
      } else if (m.type === 'tracks') {
        if (m.tag === 'sel') {
          drawSelOrbit(new Float32Array(m.tracks[0]));
        } else {
          state.scenarioTracks = m.tracks.map(b => new Float32Array(b));
          drawScenarioOrbits();
        }
      }
    };
    worker.postMessage({ type: 'init', tle1, tle2 });
  });
}

let propInFlight = false;
function requestPropagation(t) {
  if (!workerReady) return;
  worker.postMessage({ type: 'propagate', time: t });
}

// ============================================================
// 3. Three.js scene
// ============================================================
let renderer, scene, camera, controls, points, earthMesh, earthGroup, atmosphere;
let sunDirWorld, earthMaterial, sunLight;
let selOrbitLine = null, flyAnim = null;
let raycaster, pointer, hoverIndex = -1, selectedIndex = -1;
let colorAttr, sizeAttr, posAttr, geom;
let selMarker;

function initThree() {
  const canvas = $('#scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const [vw0, vh0] = viewSize();
  renderer.setSize(vw0, vh0);
  renderer.setClearColor(0x05070d, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(42, vw0 / vh0, 0.1, 20000);
  camera.position.set(6, 10, 36);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.5;
  controls.minDistance = RE_SCENE + 0.5;
  controls.maxDistance = 220;
  controls.zoomSpeed = 0.8;

  // Starfield background
  addStarfield();

  // Earth
  earthGroup = new THREE.Group();
  scene.add(earthGroup);
  // 2K day texture for everyone (preloaded by index.html); large, fine-pointer
  // screens swap in the 4K texture once the page is live.
  const tex = new THREE.TextureLoader().load('./assets/earth_day_2k.webp', () => { render(); });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const nightTex = new THREE.TextureLoader().load('./assets/earth_night.webp', () => { render(); });
  nightTex.colorSpace = THREE.SRGBColorSpace;
  nightTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const earthGeo = new THREE.SphereGeometry(RE_SCENE, 96, 96);
  // Physically-motivated day/night shader: NASA Blue Marble day side,
  // Black Marble city lights on the night side, real solar terminator
  // computed from the simulation clock, and specular sun-glint on oceans.
  sunDirWorld = new THREE.Vector3(1, 0, 0);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayTex: { value: tex },
      nightTex: { value: nightTex },
      uSun: { value: sunDirWorld }
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vUv = uv;
        vWN = normalize(mat3(modelMatrix) * normal);
        vWP = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D dayTex; uniform sampler2D nightTex; uniform vec3 uSun;
      varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vec3 n = normalize(vWN);
        vec3 s = normalize(uSun);
        float sunAmt = dot(n, s);
        float dayMix = smoothstep(-0.12, 0.28, sunAmt);
        vec3 day = texture2D(dayTex, vUv).rgb;
        vec3 night = texture2D(nightTex, vUv).rgb;
        // ocean mask from the day map (oceans are blue-dominant)
        float ocean = smoothstep(0.02, 0.18, day.b - day.r);
        vec3 viewDir = normalize(cameraPosition - vWP);
        vec3 halfDir = normalize(s + viewDir);
        float spec = pow(max(dot(n, halfDir), 0.0), 64.0) * ocean * dayMix;
        vec3 dayCol = day * (0.16 + 1.15 * max(sunAmt, 0.0)) + vec3(0.95, 0.88, 0.72) * spec * 0.6;
        vec3 lights = night * vec3(1.0, 0.82, 0.55) * 2.3;
        vec3 nightCol = lights + day * vec3(0.030, 0.042, 0.065);
        vec3 col = mix(nightCol, dayCol, dayMix);
        // subtle warm band along the terminator
        float term = 1.0 - smoothstep(0.0, 0.18, abs(sunAmt));
        col += vec3(0.10, 0.045, 0.0) * term * dayMix;
        // faint camera-facing rim so the night limb stays defined
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        col += vec3(0.10, 0.16, 0.24) * rim * 0.55;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  earthMesh = new THREE.Mesh(earthGeo, earthMat);
  earthMaterial = earthMat;
  // rotate so texture longitude 0 aligns with ECEF x-axis; texture center = lon 0
  earthMesh.rotation.y = -Math.PI / 2;
  earthGroup.add(earthMesh);

  // Atmosphere shell
  const atmGeo = new THREE.SphereGeometry(RE_SCENE * 1.025, 64, 64);
  const atmMat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false,
    uniforms: { uSun: { value: sunDirWorld } },
    vertexShader: `varying vec3 vN; varying vec3 vWN; void main(){ vN = normalize(normalMatrix * normal); vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vN; varying vec3 vWN; uniform vec3 uSun;
      void main(){
        float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 2.4);
        float day = smoothstep(-0.35, 0.35, dot(normalize(vWN), normalize(uSun)));
        vec3 col = mix(vec3(0.10, 0.20, 0.40), vec3(0.31, 0.63, 0.90), day);
        gl_FragColor = vec4(col, 1.0) * i * (0.42 + 0.62 * day);
      }`
  });
  atmosphere = new THREE.Mesh(atmGeo, atmMat);
  earthGroup.add(atmosphere);

  // Lights (marker/lines are unlit; kept for any standard materials)
  sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  sunLight.position.set(30, 12, 20);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x2a3348, 1.4));

  // selection marker ring
  const ringGeo = new THREE.RingGeometry(0.25, 0.32, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4fd1e0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  selMarker = new THREE.Mesh(ringGeo, ringMat);
  selMarker.visible = false;
  scene.add(selMarker);

  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.4;
  pointer = new THREE.Vector2();

  window.addEventListener('resize', onResize);
  // The canvas host also changes size without a window resize (the top bar
  // wraps on narrow screens, mobile toolbars collapse) — track it directly.
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas.parentElement);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  // Mobile browsers retarget a tap to any clickable element near the finger
  // (touch adjustment) unless the element under it is clickable too: without
  // this listener a dot a few px from the Controls button opened the rail
  // instead of the dot. Picking itself runs on pointerup.
  renderer.domElement.addEventListener('click', () => {});
}

function addStarfield() {
  // Two-layer starfield: a dim base population plus a sparse bright layer,
  // with black-body-ish colour temperature variation for realism.
  const disc = makeDiscTexture();
  const mk = (n, sizePx, opacity, brightBoost) => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 800 + Math.random() * 400;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      p[i*3] = r * Math.sin(ph) * Math.cos(th);
      p[i*3+1] = r * Math.sin(ph) * Math.sin(th);
      p[i*3+2] = r * Math.cos(ph);
      // power-law brightness + colour temperature (blue-white .. warm)
      const b = (0.35 + 0.65 * Math.pow(Math.random(), 2.2)) * brightBoost;
      const t = Math.random();
      const rr = b * (t < 0.7 ? 0.82 + 0.18 * t : 1.0);
      const gg = b * (0.86 + 0.10 * Math.sin(t * 3.1));
      const bb = b * (t < 0.7 ? 1.0 : 0.80 - 0.25 * (t - 0.7));
      c[i*3] = rr; c[i*3+1] = gg; c[i*3+2] = bb;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.PointsMaterial({ size: sizePx * renderer.getPixelRatio(), sizeAttenuation: false,
      map: disc, transparent: true, opacity, vertexColors: true,
      depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(g, m));
  };
  mk(3200, 1.6, 0.6, 0.8);   // base population
  mk(240, 3.2, 0.85, 1.15);  // bright stars
}

// Circular sprite texture for additive points
function makeDiscTexture() {
  const s = 128;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.98)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function buildPointCloud() {
  const N = state.N;
  geom = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  colorAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  sizeAttr = new THREE.BufferAttribute(new Float32Array(N), 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('color', colorAttr);
  geom.setAttribute('size', sizeAttr);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uPix: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float size;
      uniform float uPix;
      varying vec3 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mv.z) * uPix;
        gl_PointSize = clamp(gl_PointSize, 1.0 * uPix, 12.0 * uPix);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main(){
        // Analytic disc: crisp antialiased core + subtle additive halo,
        // sharp at every point size and pixel ratio (no texture blur).
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        float core = 1.0 - smoothstep(0.40, 0.60, r);
        float halo = (1.0 - smoothstep(0.25, 1.00, r)) * 0.12;
        float a = clamp(core + halo, 0.0, 1.0);
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexColors: true
  });
  points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  scene.add(points);
  updateColors();
}

// ============================================================
// 4. Color + filter logic
// ============================================================
const _c = new THREE.Color();
function colorFor(i) {
  const m = state.colorMode;
  if (m === 'type') return COL_TYPE[state.objType[i]] || 0x8a9bb5;
  if (m === 'state') {
    const code = state.ownerCode[i];
    return STATE_COLORS[code] !== undefined ? STATE_COLORS[code] : STATE_COLORS.OTHER;
  }
  if (m === 'reg') {
    if (state.objType[i] !== 'PAY') return REG_COLORS.na;
    return state.registered[i] ? REG_COLORS.reg : REG_COLORS.unreg;
  }
  if (m === 'const') {
    const key = constKey(state.constLabel[i]);
    return CONST_COLORS[key] !== undefined ? CONST_COLORS[key] : CONST_COLORS.other;
  }
  return 0x8a9bb5;
}
function constKey(label) {
  if (!label) return 'none';
  if (label.startsWith('Starlink')) return 'Starlink';
  if (label.startsWith('OneWeb')) return 'OneWeb';
  if (label.startsWith('Qianfan')) return 'Qianfan';
  if (label.startsWith('Guowang')) return 'Guowang';
  if (label.startsWith('Kuiper')) return 'Kuiper';
  return 'other';
}

function passesFilter(i) {
  const f = state.filters;
  if (f.state && state.ownerCode[i] !== f.state) return false;
  if (f.type && state.objType[i] !== f.type) return false;
  if (f.const !== '') {
    if (f.const === '__none') { if (state.constLabel[i] !== '') return false; }
    else if (constKey(state.constLabel[i]) !== f.const) return false;
  }
  if (f.reg !== '') {
    if (state.objType[i] !== 'PAY') return false;
    if (String(state.registered[i]) !== f.reg) return false;
  }
  if (f.regime !== '' && state.regime && String(state.regime[i]) !== f.regime) return false;
  return true;
}

let visibleCount = 0;
function updateColors() {
  const N = state.N;
  const ca = colorAttr.array, sa = sizeAttr.array;
  visibleCount = 0;
  for (let i = 0; i < N; i++) {
    const vis = passesFilter(i);
    if (vis) visibleCount++;
    _c.setHex(colorFor(i));
    // dim filtered-out points strongly
    const f = vis ? 1 : 0.045;
    ca[i*3] = _c.r * f; ca[i*3+1] = _c.g * f; ca[i*3+2] = _c.b * f;
    // payloads slightly larger, debris small
    let base = state.objType[i] === 'DEB' ? 0.7 : (state.objType[i] === 'R/B' ? 1.2 : 0.95);
    if (i === selectedIndex) base = 4.4;
    sa[i] = vis ? base : 0.55;
  }
  colorAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
  const vc = $('#visibleCount');
  if (vc) vc.textContent = visibleCount.toLocaleString() + ' / ' + N.toLocaleString() + ' objects shown';
}

// ============================================================
// 5. Position update (ECI -> ECEF via GMST, scaled)
// ============================================================
function applyPositions() {
  if (!state.lastPositions) return;
  const pos = state.lastPositions, alive = state.lastAlive;
  const pa = posAttr.array;
  const N = state.N;
  // Render everything in the ECI frame: satellites keep their inertial ECI
  // coordinates and the Earth is rotated by GMST to sit correctly beneath them.
  // three.js Y-up: map ECI (x,y,z) -> scene (x, z, -y) so the pole is along +Y.
  for (let i = 0; i < N; i++) {
    if (!alive[i]) {
      pa[i*3] = 0; pa[i*3+1] = -99999; pa[i*3+2] = 0;
      continue;
    }
    pa[i*3]   = pos[i*3]   * SCALE;
    pa[i*3+1] = pos[i*3+2] * SCALE;
    pa[i*3+2] = -pos[i*3+1] * SCALE;
  }
  posAttr.needsUpdate = true;

  if (selectedIndex >= 0 && alive[selectedIndex]) {
    selMarker.position.set(pa[selectedIndex*3], pa[selectedIndex*3+1], pa[selectedIndex*3+2]);
    selMarker.visible = true;
    selMarker.lookAt(camera.position);
    // Constant screen size (~20 px) with a slow pulse — unmissable at any zoom.
    const selDist = camera.position.distanceTo(selMarker.position);
    const pulse = REDUCED_MOTION ? 1 : 1 + 0.16 * Math.sin(performance.now() * 0.004);
    selMarker.scale.setScalar(selDist * 0.052 * pulse);
    selMarker.material.opacity = REDUCED_MOTION ? 1 : 0.75 + 0.25 * Math.sin(performance.now() * 0.004);
    updateDetailLive(selectedIndex);
  } else {
    selMarker.visible = false;
  }
}

// ============================================================
// 6. Time loop
// ============================================================
let lastFrame = performance.now();
let lastPropReq = 0;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastFrame) / 1000; lastFrame = now;

  if (histMode) {
    histTick(dt, now);
  } else if (state.playing) {
    state.simTime += dt * 1000 * state.speed;
  }
  updateClock();
  updateSun(state.simTime);

  // camera fly-to animation (search / permalink selection)
  if (flyAnim) {
    const k = Math.min(1, (now - flyAnim.t0) / flyAnim.dur);
    const s = k * k * (3 - 2 * k); // smoothstep ease
    camera.position.lerpVectors(flyAnim.from, flyAnim.to, s);
    if (k >= 1) flyAnim = null;
  }

  // Earth rotation: rotate the Earth by GMST so the ECEF surface aligns with
  // the inertial (ECI) satellite positions. Scene maps ECI y->-z, so a positive
  // rotation about the ECI z-axis is a rotation about scene +Y.
  if (earthGroup && state.ready) {
    earthGroup.rotation.y = histMode ? histMode.gmst : state.lastGmst;
  }

  // request new propagation ~10Hz (or when speed high, each frame-ish)
  if (!histMode && workerReady && now - lastPropReq > (IS_TOUCH ? 240 : 90)) {
    requestPropagation(state.simTime);
    lastPropReq = now;
  }
  if (!histMode) applyPositions();
  controls.update();
  render();
}

function render() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// Low-precision solar ephemeris (Meeus). Returns the Sun direction as a unit
// vector in the scene frame (ECI mapped x,y,z -> x,z,-y), driven by the
// simulation clock so the terminator is astronomically correct.
function updateSun(tMs) {
  const d = tMs / 86400000 - 10957.5;            // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * DEG;    // mean anomaly
  const q = (280.459 + 0.98564736 * d) * DEG;    // mean longitude
  const L = q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;     // obliquity
  const x = Math.cos(L), y = Math.cos(e) * Math.sin(L), z = Math.sin(e) * Math.sin(L);
  if (sunDirWorld) {
    sunDirWorld.set(x, z, -y).normalize();
    if (sunLight) sunLight.position.copy(sunDirWorld).multiplyScalar(200);
  }
}
const DEG = Math.PI / 180;

function updateClock() {
  const d = new Date(state.simTime);
  const p = (n) => String(n).padStart(2, '0');
  const el = $('#simclock');
  if (el) el.textContent = `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

function onResize() {
  const [w, h] = viewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  if (points) points.material.uniforms.uPix.value = renderer.getPixelRatio();
}

// ------------------------------------------------------------
// Screen geometry. The canvas sits BELOW the top bar, so its origin is not
// the window's: every screen <-> scene conversion must use the canvas's own
// client rect. (Using window.innerWidth/innerHeight here shifted every hit
// test by the top-bar height, so clicks on a dot missed it and clicks in
// the empty space above a dot selected it.)
// ------------------------------------------------------------
function viewSize() {
  const host = $('#scene').parentElement;
  return [Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)];
}
function viewRect() { return renderer.domElement.getBoundingClientRect(); }
// Project a scene point to client (CSS px, window-relative) coordinates.
// Leaves the NDC depth in _pv.z for callers.
function toClient(x, y, z, r) {
  _pv.set(x, y, z).project(camera);
  return { x: r.left + (_pv.x * 0.5 + 0.5) * r.width, y: r.top + (-_pv.y * 0.5 + 0.5) * r.height, z: _pv.z };
}
function setPointerFromClient(cx, cy) {
  const r = viewRect();
  pointer.x = ((cx - r.left) / r.width) * 2 - 1;
  pointer.y = -((cy - r.top) / r.height) * 2 + 1;
}

// ============================================================
// 7. Picking / detail card
// ============================================================
let lastHover = 0;
function onPointerMove(e) {
  setPointerFromClient(e.clientX, e.clientY);
  // Desktop hover affordance: pointer cursor over any selectable object.
  if (IS_TOUCH || !points || !state.lastAlive || downXY) return;
  const now = performance.now();
  if (now - lastHover < 120) return;
  lastHover = now;
  const sx = e.clientX, sy = e.clientY;
  const pa = posAttr.array, r = viewRect();
  let hit = false;
  for (let i = 0; i < state.N; i++) {
    if (!state.lastAlive[i]) continue; // dimmed (filtered-out) dots are pickable too
    const q = toClient(pa[i*3], pa[i*3+1], pa[i*3+2], r);
    if (q.z > 1) continue;
    // same radius as the click, so the pointer cursor never promises less
    // (or more) than a click delivers
    if (Math.hypot(q.x - sx, q.y - sy) <= PICK_RADIUS && !earthOccluded(pa[i*3], pa[i*3+1], pa[i*3+2])) { hit = true; break; }
  }
  renderer.domElement.style.cursor = hit ? 'pointer' : '';
}
let downXY = null;
let downPosSnap = null; // positions at pointerdown — dots move while the sim plays,
// so the pick also tests where each dot was when the user began the click.
let downSnapT = 0;
function onPointerDown(e) {
  downXY = { x: e.clientX, y: e.clientY, t: performance.now() };
  downPosSnap = (posAttr && posAttr.array) ? posAttr.array.slice() : null;
  downSnapT = performance.now();
}
let lastUp = null; // last pointerup's classification (read by the QA gate)
let lastClose = null; // how the object card was last closed (read by the QA gate)
renderPickBind();
function renderPickBind() {
  document.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y);
    const dt = performance.now() - downXY.t;
    downXY = null;
    lastUp = { moved, dt, onCanvas: e.target === renderer?.domElement, type: e.pointerType };
    if (moved > 8 || dt > 900) return; // drag, not click
    if (e.target !== renderer?.domElement) return;
    setPointerFromClient(e.clientX, e.clientY);
    pickAt(e.clientX, e.clientY);
    // the click this tap produces lands after the card / chooser has opened,
    // possibly on it — see the capture listener below
    swallowClickUntil = performance.now() + 700;
  });
}

// Manual screen-space nearest-point pick. More reliable than Three's Points
// raycaster for a large DynamicDrawUsage buffer whose bounding sphere is not
// recomputed each frame. Projects candidate points to screen and finds the
// closest visible one within a pixel radius, preferring nearer-camera objects.
const _pv = new THREE.Vector3();
// True when the scene point (x,y,z) is hidden behind the Earth's disc from the
// current camera position — such points are excluded from picking so a click
// always lands on the dot the viewer can actually see.
function earthOccluded(x, y, z) {
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const L2 = dx * dx + dy * dy + dz * dz;
  if (L2 === 0) return false;
  const t = -(cx * dx + cy * dy + cz * dz) / L2; // closest approach to Earth centre
  if (t <= 0 || t >= 1) return false;
  const qx = cx + t * dx, qy = cy + t * dy, qz = cz + t * dz;
  const R = RE_SCENE * 0.985;
  return (qx * qx + qy * qy + qz * qz) < R * R;
}
// sx, sy: client (window-relative CSS px) coordinates of the click.
function pickAt(sx, sy) {
  if (!points || !state.lastAlive) return;
  const r = viewRect();
  const pa = posAttr.array;
  // The pointerdown snapshot is only trusted for the click it belongs to:
  // it must be fresh (a click's down→up span) and is consumed after use, so
  // a stale snapshot can never pull the pick toward long-outdated positions.
  const snap = (downPosSnap && downPosSnap.length === pa.length && (performance.now() - downSnapT) < 1500) ? downPosSnap : null;
  downPosSnap = null;
  const N = state.N;
  const RADIUS = PICK_RADIUS;
  hidePickChooser();
  const cands = [];
  for (let i = 0; i < N; i++) {
    if (!state.lastAlive[i]) continue;
    // Every rendered dot is pickable — including dots dimmed by an active
    // filter. A visible dot that ignores clicks reads as broken; the detail
    // card is evidence regardless of the current filter view.
    const wx = pa[i*3], wy = pa[i*3+1], wz = pa[i*3+2];
    const q = toClient(wx, wy, wz, r);
    if (q.z > 1) continue; // behind camera / clipped
    const depth = q.z;
    let d = Math.hypot(q.x - sx, q.y - sy);
    // While playing, a dot may have drifted between aim and click — also
    // accept a hit on the dot's position captured at pointerdown.
    if (snap && d > 2) {
      const q0 = toClient(snap[i*3], snap[i*3+1], snap[i*3+2], r);
      if (q0.z <= 1) {
        const d0 = Math.hypot(q0.x - sx, q0.y - sy);
        if (d0 < d) d = d0;
      }
    }
    if (d > RADIUS) continue;
    if (earthOccluded(wx, wy, wz)) continue; // hidden behind the Earth
    // prefer closest-to-cursor, strongly favouring nearer-camera (front)
    // objects; dots dimmed by an active filter rank slightly behind.
    cands.push({ i, d, s: d + depth * 30 + (passesFilter(i) ? 0 : 3), f: passesFilter(i) });
  }
  if (lastUp) { lastUp.x = sx; lastUp.y = sy; lastUp.cands = cands.length; }
  if (!cands.length) return;
  cands.sort((a, b) => a.s - b.s);
  // Dots under the cursor itself. When two or more objects are drawn on the
  // same few pixels (common in the dense LEO shells when zoomed out) a click
  // cannot tell them apart — silently taking the fractionally nearest one
  // opened an object the user did not aim at, so ask instead.
  const onDot = cands.filter(c => c.d <= DIRECT_RADIUS);
  if (onDot.length === 1) { selectObject(onDot[0].i); return; }
  if (onDot.length === 0 && (cands.length === 1 || cands[1].d - cands[0].d >= 6)) { selectObject(cands[0].i); return; }
  showPickChooser(cands.slice(0, 40), sx, sy, cands.length);
}

// Place the chooser beside the click point, NEVER over it: on touch screens
// the tap that opened the chooser is followed by a synthetic click at the
// same spot, which would otherwise land on (and select) whatever row ended
// up under the finger. The finger also hides anything drawn beneath it.
function placePickChooser(el, sx, sy) {
  const vw = window.innerWidth, vh = window.innerHeight, M = 8, G = 14;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let W = el.offsetWidth, H = el.offsetHeight;
  // Beside the point (right, then left), vertically clamped.
  if (sx + G + W <= vw - M || sx - G - W >= M) {
    const left = (sx + G + W <= vw - M) ? sx + G : sx - G - W;
    el.style.left = left + 'px';
    el.style.top = clamp(sy - 24, M, vh - H - M) + 'px';
    return;
  }
  // Otherwise above or below it (whichever has more room), horizontally
  // clamped; shrink the list to the room available so it cannot overlap.
  const below = vh - M - (sy + G), above = (sy - G) - M;
  const room = Math.max(below, above);
  if (H > room) { el.style.maxHeight = Math.max(120, room) + 'px'; H = el.offsetHeight; }
  el.style.left = clamp(sx - W / 2, M, vw - W - M) + 'px';
  el.style.top = (below >= above ? sy + G : sy - G - H) + 'px';
}
// Swallow the one click event that the picking tap/click itself produces
// when it lands anywhere but the globe — e.g. on the chooser or the object
// card that the tap has just opened under the finger (on phones the card's
// close button sits over the right-hand edge of the globe).
let swallowClickUntil = 0;
// a new touch or press anywhere else is a deliberate action — never swallow it
document.addEventListener('pointerdown', (e) => { if (e.target !== renderer?.domElement) swallowClickUntil = 0; }, true);
document.addEventListener('click', (e) => {
  if (performance.now() < swallowClickUntil && e.target !== renderer?.domElement) {
    e.stopPropagation(); e.preventDefault();
  }
  swallowClickUntil = 0;
}, true);

// Disambiguation chooser — in dense clusters every object stays reachable.
let pickEl = null;
function hidePickChooser() { if (pickEl) { pickEl.remove(); pickEl = null; } }
function showPickChooser(cands, sx, sy, total) {
  pickEl = document.createElement('div');
  pickEl.id = 'pickChooser';
  const more = (total || cands.length) - cands.length;
  pickEl.innerHTML = `<div class="pc-h">${total || cands.length} objects here — select one${more > 0 ? ` <span style=\"opacity:.55\">(${more} more — zoom in to separate)</span>` : ''}</div>` + cands.map(c => `
    <button class="sr" data-i="${c.i}">
      <span class="sr-name">${state.name[c.i]}</span>
      <span class="sr-meta">${state.norad[c.i]} · ${fullType(state.objType[c.i])} · ${state.ownerCode[c.i]}${c.f === false ? ' · <em>filtered out</em>' : ''}</span>
    </button>`).join('');
  document.body.appendChild(pickEl);
  placePickChooser(pickEl, sx, sy);
  pickEl.querySelectorAll('.sr').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    selectObject(parseInt(b.dataset.i, 10));
    hidePickChooser();
  }));
  setTimeout(() => {
    document.addEventListener('pointerdown', function dismiss(e) {
      if (pickEl && !pickEl.contains(e.target)) hidePickChooser();
      if (!pickEl) document.removeEventListener('pointerdown', dismiss);
    });
  }, 0);
}

function selectObject(i, fly) {
  selectedIndex = i;
  dismissFirstHint();
  updateColors();
  showDetail(i);
  requestSelOrbit(i);
  if (fly) flyToIndex(i);
  syncURL();
}

// One-period orbit trail for the selected object, propagated by the SGP4
// worker in the ECI frame (the render frame), so the path is exact.
function requestSelOrbit(i) {
  clearSelOrbit();
  if (!workerReady) return;
  const tle2 = state.tle2[i];
  const mm = parseFloat(tle2.substring(52, 63)); // rev/day
  const periodMs = (mm > 0 ? 1440 / mm : 95) * 60 * 1000;
  const t0 = state.simTime;
  const times = [];
  const STEPS = 180;
  for (let k = 0; k <= STEPS; k++) times.push(t0 + (k / STEPS) * periodMs);
  worker.postMessage({ type: 'track', indices: [i], times, tag: 'sel' });
}

function drawSelOrbit(track) {
  clearSelOrbit();
  const n = track.length / 3;
  const p = new Float32Array(n * 3);
  let valid = 0;
  for (let j = 0; j < n; j++) {
    const x = track[j*3], y = track[j*3+1], z = track[j*3+2];
    if (x === 0 && y === 0 && z === 0) continue;
    p[valid*3] = x * SCALE; p[valid*3+1] = z * SCALE; p[valid*3+2] = -y * SCALE;
    valid++;
  }
  if (valid < 2) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.slice(0, valid * 3), 3));
  const m = new THREE.LineBasicMaterial({ color: 0x4fd1e0, transparent: true, opacity: 0.55 });
  selOrbitLine = new THREE.Line(g, m);
  scene.add(selOrbitLine);
}

function clearSelOrbit() {
  if (selOrbitLine) {
    scene.remove(selOrbitLine);
    selOrbitLine.geometry.dispose();
    selOrbitLine.material.dispose();
    selOrbitLine = null;
  }
}

function flyToIndex(i) {
  if (!state.lastPositions || !state.lastAlive || !state.lastAlive[i]) return;
  const pa = posAttr.array;
  const p = new THREE.Vector3(pa[i*3], pa[i*3+1], pa[i*3+2]);
  if (p.length() < 0.01) return;
  const dist = Math.min(Math.max(p.length() * 1.55, RE_SCENE * 2.2), 200);
  flyAnim = {
    from: camera.position.clone(),
    to: p.clone().normalize().multiplyScalar(dist),
    t0: performance.now(), dur: REDUCED_MOTION ? 1 : 950
  };
}

function showDetail(i) {
  const el = $('#detail');
  $('#dName').textContent = state.name[i];
  $('#dType').textContent = fullType(state.objType[i]);
  const rows = $('#dRows');
  const regBadge = state.objType[i] !== 'PAY'
    ? '<span class="badge na">Not assessed · non-payload</span>'
    : (state.registered[i] ? '<span class="badge reg">Matched UN record</span>' : '<span class="badge unreg">No matching UN record</span>');
  rows.innerHTML = `
    <div class="drow"><span class="k">NORAD ID</span><span class="v">${state.norad[i]}</span></div>
    <div class="drow"><span class="k">Intl designator</span><span class="v">${state.intl[i]}</span></div>
    <div class="drow"><span class="k">Attributed State (SATCAT owner code)</span><span class="v">${state.ownerName[i]} (${state.ownerCode[i]})</span></div>
    <div class="drow"><span class="k">Constellation</span><span class="v">${state.constLabel[i] || '—'}</span></div>
    <div class="drow"><span class="k">UN registration (GCAT match)</span><span class="v">${regBadge}</span></div>
    <div class="drow ts-drow"><span class="k">Treaty status of attributed State</span><span class="v">${treatyBlock(state.ownerCode[i])}</span></div>
    <div class="ts-src">${treatySourceLine()}</div>
    <div class="drow"><span class="k">Launch year</span><span class="v">${state.launchYear[i] || '—'}</span></div>
    <div class="drow"><span class="k">Orbital regime</span><span class="v">${regimeName(state.regime ? state.regime[i] : 0)}</span></div>
    <div class="drow"><span class="k">Altitude</span><span class="v live" id="dAlt">—</span></div>
    <div class="drow"><span class="k">Inclination</span><span class="v live" id="dInc">—</span></div>
    <div class="drow"><span class="k">Period</span><span class="v live" id="dPer">—</span></div>
    <div class="dverify">
      <div class="k">Verify this object</div>
      <div class="vlinks">
        <a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${state.norad[i]}" target="_blank" rel="noopener">CelesTrak SATCAT</a>
        <a href="https://www.n2yo.com/satellite/?s=${state.norad[i]}" target="_blank" rel="noopener">N2YO live track</a>
        <a href="https://www.unoosa.org/oosa/osoindex/index.jspx" target="_blank" rel="noopener">UNOOSA Online Index</a>
      </div>
      <button class="dcopy" id="dCopy">Copy link to this object</button>
    </div>`;
  const cp = $('#dCopy');
  if (cp) cp.addEventListener('click', () => {
    const url = location.origin + location.pathname + '?sat=' + state.norad[i];
    copyText(url).then(ok => {
      if (ok) {
        cp.textContent = 'Link copied ✓';
        setTimeout(() => { cp.textContent = 'Copy link to this object'; }, 1600);
      } else { cp.textContent = url; }
    });
  });
  el.classList.add('show');
}

function updateDetailLive(i) {
  if (!state.lastPositions || !state.lastAlive[i]) return;
  const x = state.lastPositions[i*3], y = state.lastPositions[i*3+1], z = state.lastPositions[i*3+2];
  const r = Math.sqrt(x*x + y*y + z*z);
  const alt = r - EARTH_R;
  const altEl = $('#dAlt'); if (altEl) altEl.textContent = alt.toFixed(0) + ' km';
  // inclination & period from TLE line 2
  const tle2 = state.tle2[i];
  const inc = parseFloat(tle2.substring(8, 16));
  const mm = parseFloat(tle2.substring(52, 63)); // rev/day
  const incEl = $('#dInc'); if (incEl) incEl.textContent = isNaN(inc) ? '—' : inc.toFixed(2) + '°';
  const perEl = $('#dPer'); if (perEl && !isNaN(mm) && mm > 0) perEl.textContent = (1440 / mm).toFixed(1) + ' min';
}

function fullType(t) {
  return { 'PAY': 'Payload', 'R/B': 'Rocket body', 'DEB': 'Debris', 'UNK': 'Unknown' }[t] || t;
}
function regimeName(r) { return ['LEO', 'MEO', 'GEO', 'HEO'][r] || 'LEO'; }

// ============================================================
// 8. Legends
// ============================================================
function renderLegend() {
  const el = $('#legend');
  const m = state.colorMode;
  let rows = [];
  let footnote = '';
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  if (m === 'type') {
    rows = [['Payload', COL_TYPE['PAY'], count(i => state.objType[i]==='PAY')],
            ['R/B & other\u2020', COL_TYPE['R/B'], count(i => state.objType[i]==='R/B' || state.objType[i]==='UNK')],
            ['Debris', COL_TYPE['DEB'], count(i => state.objType[i]==='DEB')]];
    const catalogRB = (state.stats.by_type && state.stats.by_type['R/B']) || 0;
    const renderedRB = count(i => state.objType[i] === 'R/B');
    const noGPRB = Math.max(0, catalogRB - renderedRB);
    footnote = `\u2020 ${noGPRB.toLocaleString('en-GB')} of the ${catalogRB.toLocaleString('en-GB')} catalogued rocket bodies are not propagated here (only CelesTrak’s active set and four debris clouds are loaded); they are included in the catalogue statistics panels.`;
  } else if (m === 'state') {
    const codes = ['US','CIS','PRC','UK','JPN','FR','IND','ESA'];
    let listed = 0;
    rows = codes.map(c => { const n = count(i => state.ownerCode[i] === c); listed += n;
      return [state.stats.owner_names[c] || c, STATE_COLORS[c], n]; });
    rows.push(['Other States', STATE_COLORS.OTHER, state.N - listed]);
    footnote = 'Counts are propagated objects per attributed State (SATCAT owner code, an evidentiary proxy) — not the launching State, the State of registry, or a determination of the ‘appropriate State Party’ under Article VI. Catalogue-wide payload figures are in the Art VI panel.';
  } else if (m === 'reg') {
    rows = [['Matched UN record (payload)', REG_COLORS.reg, count(i => state.objType[i] === 'PAY' && state.registered[i])],
            ['No matching UN record (payload)', REG_COLORS.unreg, count(i => state.objType[i] === 'PAY' && !state.registered[i])],
            ['Not assessed · non-payload', REG_COLORS.na, count(i => state.objType[i] !== 'PAY')]];
    footnote = 'Matching is shown for propagated payloads, cross-referenced against GCAT’s UN registration field. Submissions lag launch — ‘no matching UN record’ includes filings not yet matched. A missing match is not a finding of non-compliance.';
  } else if (m === 'const') {
    rows = [['Starlink', CONST_COLORS.Starlink, count(i=>constKey(state.constLabel[i])==='Starlink')],
            ['OneWeb', CONST_COLORS.OneWeb, count(i=>constKey(state.constLabel[i])==='OneWeb')],
            ['Qianfan/G60', CONST_COLORS.Qianfan, count(i=>constKey(state.constLabel[i])==='Qianfan')],
            ['Guowang', CONST_COLORS.Guowang, count(i=>constKey(state.constLabel[i])==='Guowang')],
            ['Kuiper', CONST_COLORS.Kuiper, count(i=>constKey(state.constLabel[i])==='Kuiper')],
            ['Other constellation', CONST_COLORS.other, count(i=>state.constLabel[i] !== '' && constKey(state.constLabel[i])==='other')],
            ['Not in constellation', CONST_COLORS.none, count(i=>state.constLabel[i] === '')]];
  }
  el.innerHTML = rows.map(([lbl, col, ct]) =>
    `<div class="legend-row"><span class="sw" style="background:${hex(col)};color:${hex(col)}"></span>${lbl}${ct!=null?`<span class="ct">${ct.toLocaleString()}</span>`:''}</div>`
  ).join('') + (footnote ? `<div class="legend-note">${footnote}</div>` : '');
}
function count(pred) { let c = 0; for (let i = 0; i < state.N; i++) if (pred(i)) c++; return c; }
function countActive(code) { return state.stats.by_owner_active[code] || 0; }

// ============================================================
// 9. Populate filter selects
// ============================================================
function populateFilters() {
  const fState = $('#fState');
  // Owner counts = propagated objects of every type per owner, so the number
  // beside each option equals exactly what the filter shows when selected.
  const ownerCount = {};
  for (let i = 0; i < state.N; i++) ownerCount[state.ownerCode[i]] = (ownerCount[state.ownerCode[i]] || 0) + 1;
  const owners = Object.entries(ownerCount).sort((a,b) => b[1]-a[1]);
  for (const [code, n] of owners) {
    const name = state.stats.owner_names[code] || code;
    const o = document.createElement('option');
    const disp = name.includes(`(${code})`) ? name : `${name} (${code})`;
    o.value = code; o.textContent = `${disp} · ${n.toLocaleString('en-GB')}`;
    fState.appendChild(o);
  }
  // object-type counts (propagated population)
  const tc = { 'PAY': 0, 'R/B': 0, 'DEB': 0 };
  for (let i = 0; i < state.N; i++) if (tc[state.objType[i]] !== undefined) tc[state.objType[i]]++;
  const tLabels = { 'PAY': 'Payloads', 'R/B': 'Rocket bodies', 'DEB': 'Debris' };
  $$('#fType option').forEach(o => {
    if (o.value) o.textContent = `${tLabels[o.value]} · ${(tc[o.value] || 0).toLocaleString('en-GB')}`;
  });
  // constellation counts, ordered largest → smallest
  const cc = { Starlink: 0, OneWeb: 0, Qianfan: 0, Guowang: 0, Kuiper: 0, other: 0, __none: 0 };
  for (let i = 0; i < state.N; i++) {
    const l = state.constLabel[i];
    if (!l) { cc.__none++; continue; }
    const k = constKey(l);
    cc[k] = (cc[k] || 0) + 1;
  }
  const cLabels = { Starlink: 'Starlink (SpaceX)', OneWeb: 'OneWeb', Qianfan: 'Qianfan/G60',
    Guowang: 'Guowang', Kuiper: 'Kuiper (Amazon)', other: 'Other constellation', __none: 'Not in a constellation' };
  const fConst = $('#fConst');
  const named = ['Starlink', 'OneWeb', 'Qianfan', 'Guowang', 'Kuiper', 'other'].sort((a, b) => cc[b] - cc[a]);
  [...named, '__none'].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = `${cLabels[v]} · ${cc[v].toLocaleString('en-GB')}`;
    fConst.appendChild(o);
  });
  // registration counts (payloads only — the filter applies to payloads)
  let reg = 0, unreg = 0;
  for (let i = 0; i < state.N; i++) if (state.objType[i] === 'PAY') (state.registered[i] ? reg++ : unreg++);
  $$('#fReg option').forEach(o => {
    if (o.value === '1') o.textContent = `Matched UN record · ${reg.toLocaleString('en-GB')}`;
    if (o.value === '0') o.textContent = `No matching UN record · ${unreg.toLocaleString('en-GB')}`;
  });
}

// ============================================================
// 10. Panels: charts
// ============================================================
function buildArt6() {
  const data = Object.entries(state.stats.by_owner_payloads).sort((a,b)=>b[1]-a[1]).slice(0, 12);
  const max = data[0][1];
  const el = $('#art6bars');
  const hex = (c) => STATE_COLORS[c] !== undefined ? '#'+STATE_COLORS[c].toString(16).padStart(6,'0') : '#5d6b83';
  el.innerHTML = data.map(([code, n]) => {
    const name = state.stats.owner_names[code] || code;
    const w = (n / max * 100).toFixed(1);
    return `<div class="barrow"><span class="bl" title="${name}">${name}</span>
      <span class="bt"><span style="width:${w}%;background:${hex(code)};box-shadow:0 0 8px ${hex(code)}66"></span></span>
      <span class="bv">${n.toLocaleString()}</span></div>`;
  }).join('');
}

function buildRegGap() {
  const years = Object.keys(state.stats.registration_by_year).map(Number).sort((a,b)=>a-b).filter(y=>y>=2015);
  const W = 500, H = 200, padL = 34, padB = 22, padT = 8;
  const bw = (W - padL) / years.length * 0.7;
  const gap = (W - padL) / years.length;
  let maxTotal = 0;
  years.forEach(y => { const [r,u] = state.stats.registration_by_year[String(y)]; maxTotal = Math.max(maxTotal, r+u); });
  const yScale = (H - padB - padT) / maxTotal;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Payloads with and without a matching UN record, by launch year">`;
  // gridlines
  for (let g = 0; g <= 4; g++) {
    const yv = maxTotal * g / 4;
    const y = H - padB - yv * yScale;
    svg += `<line x1="${padL}" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(120,160,210,0.1)" stroke-width="0.5"/>`;
    svg += `<text x="${padL-4}" y="${y+3}" text-anchor="end" font-size="7" fill="#5d6b83" font-family="monospace">${Math.round(yv)}</text>`;
  }
  years.forEach((y, i) => {
    const [r, u] = state.stats.registration_by_year[String(y)];
    const x = padL + i * gap + (gap - bw)/2;
    const hr = r * yScale, hu = u * yScale;
    const yr = H - padB - hr;
    const yu = yr - hu;
    svg += `<rect x="${x}" y="${yr}" width="${bw}" height="${hr}" fill="#55d18b" rx="1"><title>${y}: ${r} matched UN record</title></rect>`;
    svg += `<rect x="${x}" y="${yu}" width="${bw}" height="${hu}" fill="#ff6b6b" rx="1"><title>${y}: ${u} no matching UN record</title></rect>`;
    svg += `<text x="${x + bw/2}" y="${H-padB+9}" text-anchor="middle" font-size="7" fill="#8a9bb5" font-family="monospace">'${String(y).slice(2)}</text>`;
  });
  svg += `</svg>`;
  $('#regChart').innerHTML = svg;

  // table: largest numbers of payloads with no matching UN record
  const rows = Object.entries(state.stats.registration_by_owner)
    .map(([c, [reg, un]]) => ({ c, reg, un, tot: reg+un }))
    .filter(o => o.tot >= 10)
    .sort((a,b) => b.un - a.un).slice(0, 10);
  const tb = $('#regTable tbody');
  tb.innerHTML = rows.map(o => {
    const name = state.stats.owner_names[o.c] || o.c;
    const pct = o.tot ? Math.round(o.un / o.tot * 100) : 0;
    return `<tr><td>${name}</td><td class="num">${o.reg.toLocaleString()}</td><td class="num hl">${o.un.toLocaleString()}</td><td class="num">${pct}%</td><td>${treatyCell(o.c, 'REG')}</td></tr>`;
  }).join('');
  const src = $('#regTreatySrc'); if (src) src.innerHTML = treatySourceLine();
}

// ---- Treaty party status (UNOOSA status document only) -------------------
// site/data/treaty_status.json is built by tools/build_treaty_status.py from
// the UNOOSA status table; nothing is inferred from any other source.
const TREATY_SHORT = { OST: 'OST', LIAB: 'Liability', REG: 'Registration' };
function treatyEntries(code) { const t = state.treaty; return t && t.status ? t.status[code] || null : null; }
function treatyCell(code, key) {
  const e = treatyEntries(code);
  if (!e) return '<span class="ts ts-none">not listed</span>';
  return e.map(x => `<span class="ts ts-${x[key].replace(/\s+/g, '-')}"${e.length > 1 ? ` title="${escapeHTML(x.name)}"` : ''}>${e.length > 1 ? escapeHTML(x.name) + ': ' : ''}${x[key]}</span>`).join(' ');
}
function treatySourceLine() {
  const t = state.treaty; if (!t || !t.source) return 'Treaty status unavailable.';
  return `Treaty status: UNOOSA, <a href="${t.source.url}" target="_blank" rel="noopener">UN Doc ${t.source.symbol}</a>, as at ${oscolaDate(t.source.as_at)}. ‘Party’ = ratification, acceptance, approval, accession or succession; ‘declaration’ = an intergovernmental organisation’s declaration of acceptance of rights and obligations.`;
}
function treatyBlock(code) {
  const e = treatyEntries(code), t = state.treaty;
  const note = t && t.notes && t.notes[code] ? `<div class="ts-note">${escapeHTML(t.notes[code])}</div>` : '';
  if (!e) return `<span class="ts ts-none">not listed in the UNOOSA status table</span>${note}`;
  return e.map(x => `${e.length > 1 ? `<div class="ts-who">${escapeHTML(x.name)}</div>` : ''}<div class="ts-row">${['OST', 'LIAB', 'REG'].map(k => `<span class="ts ts-${x[k].replace(/\s+/g, '-')}">${TREATY_SHORT[k]}: ${x[k]}</span>`).join(' ')}</div>`).join('') + note;
}

// ============================================================
// 11. Article IX scenario library (Phase 2 · Tasks C & D)
// ============================================================
// Each scenario is fully data-driven. `viz` describes how the 3D isolation view
// selects objects from the live catalog: `mode` is 'pair' (illustrative Aeolus/
// Starlink orbit lines), 'names' (name-prefix debris clouds), or 'geo' (Luch
// successor + ITSO GEO ring). Nothing here is hardcoded that a daily refresh
// would stale — object counts are computed from the live catalog at runtime.
const SCENARIOS = [
  {
    id: 'aeolus', title: 'Aeolus / Starlink-44', year: '2019',
    tag: 'ESA’s first manoeuvre against a large-constellation satellite',
    intro: '<strong style="color:var(--accent-warn)">2 September 2019.</strong> ESA’s Aeolus performed the agency’s first collision-avoidance manoeuvre to protect one of its spacecraft from a satellite in a large constellation — SpaceX’s Starlink-44 — half an orbit before the predicted conjunction.',
    steps: [
      { date: 'c. 26–27 Aug 2019', crit: false, txt: 'Data from the US Air Force 18th Space Control Squadron flag a potential conjunction at 11:02 UTC on 2 September between Aeolus (ESA Earth-observation mission) and Starlink-44 (SpaceX) — ‘about a week’ before the event, according to ESA.', prob: null },
      { date: '28 Aug 2019', crit: false, txt: 'With the probability rising but still below threshold (SpaceX puts it at about 1 in 50,000), ESA emails the Starlink team to discuss options. Within a day SpaceX replies that it has no plan to act at that point.', prob: 'P ≈ 1/50,000 · operators in contact' },
      { date: '29 Aug 2019 (evening)', crit: true, txt: 'Collision probability exceeds ESA’s 1-in-10,000 manoeuvre threshold for the first time. ESA prepares a manoeuvre that would raise Aeolus by about 350 m and keeps monitoring.', prob: 'P > 1/10,000 · ESA threshold crossed' },
      { date: '29 Aug – 1 Sep 2019', crit: true, txt: 'US data show the probability still rising (SpaceX later cites 1.69 × 10⁻³). A bug in SpaceX’s on-call paging system means the Starlink operator never sees ESA’s follow-up emails. On Sunday 1 September, with P ≈ 1 in 1,000 (ten times ESA’s threshold), ESA decides to manoeuvre alone, relying on SpaceX’s earlier statement that Starlink-44 would not move.', prob: 'P ≈ 1/1,000 · follow-ups unseen' },
      { date: '2 Sep 2019 · 10:14 UTC', crit: true, txt: 'Aeolus fires its thrusters at 10:14, 10:17 and 10:18 UTC, half an orbit before the predicted 11:02 UTC conjunction, raising its altitude by about 350 m — ESA’s first collision-avoidance manoeuvre to protect one of its spacecraft from a satellite in a large constellation.', prob: 'Manoeuvre executed · T-½ orbit' }
    ],
    caption: '<strong>Article IX OST.</strong> The consultation clause of Article IX applies where a State Party ‘has reason to believe’ that an activity or experiment planned by it or its nationals in outer space ‘would cause potentially harmful interference’ with activities of other States Parties. <strong>Fact pattern.</strong> The predicted conjunction was knowable from US tracking data about a week in advance (c. 26–27 August 2019). ESA and SpaceX were in contact by email from 28 August. ESA’s manoeuvre threshold was first crossed on the evening of 29 August; ESA decided on 1 September and manoeuvred at 10:14 UTC on 2 September, about 48 minutes before the predicted 11:02 UTC conjunction. The window from first warning to manoeuvre was about a week; from threshold crossing to manoeuvre, under four days.',
    viz: { mode: 'pair' }
  },
  {
    id: 'iridium', title: 'Iridium 33 / Cosmos 2251', year: '2009',
    tag: 'First accidental collision of two intact satellites',
    intro: '<strong style="color:var(--accent-warn)">10 February 2009, 16:56 UTC.</strong> An active Iridium commercial satellite and a defunct Russian Cosmos 2251 collided at 11.6 km/s over Siberia — the first accidental hypervelocity collision between two intact catalogued satellites. The debris clouds shown in the 3D view are still on orbit today.',
    steps: [
      { date: '1993', crit: false, txt: 'Cosmos 2251, a Russian Strela-2M military communications satellite, is launched; it ceases operating in 1995 and becomes derelict, uncontrolled debris.', prob: null },
      { date: '14 Sep 1997', crit: false, txt: 'Iridium 33, a US commercial mobile-communications satellite (Iridium LLC), is launched on a Russian Proton from Baikonur into the Iridium constellation.', prob: null },
      { date: '10 Feb 2009 · 15:02 UTC', crit: false, txt: 'CelesTrak’s public SOCRATES report predicts a 584 m close approach at 16:55:59 UTC — one of many sub-kilometre Iridium conjunctions that week; it never makes the Top Ten list and ranks 152nd at the time of the collision.', prob: 'Predicted miss: 584 m · not escalated' },
      { date: '10 Feb 2009 · 16:55:59 UTC', crit: true, txt: 'Collision at 778.6 km altitude over northern Siberia (72.5°N 97.9°E), relative velocity 11.647 km/s, destroying both satellites. The US military’s high-accuracy catalogue was not shared with Iridium, and JSpOC did not know that Iridium 33 had manoeuvred for station-keeping hours earlier.', prob: 'Impact · 11.647 km/s · both destroyed' },
      { date: '10 Jun 2010', crit: true, txt: 'Catalogue update: Cosmos 2251 produced 1,267 catalogued fragments (1,212 on orbit); Iridium 33 produced 521 (498 on orbit).', prob: 'Catalogued fragments: 1,788' },
      { date: 'To date', crit: true, txt: 'No claim under the 1972 Liability Convention is publicly recorded, and no Claims Commission was established.', prob: 'No public Liability Convention claim' }
    ],
    caption: '<strong>Article IX OST.</strong> The consultation clause of Article IX applies where a State Party ‘has reason to believe’ that an activity or experiment planned by it or its nationals in outer space ‘would cause potentially harmful interference’ with activities of other States Parties. <strong>Fact pattern.</strong> Cosmos 2251 had been derelict and uncontrolled since 1995; Iridium 33 was an operating commercial satellite. On the day, CelesTrak’s public SOCRATES report (15:02 UTC) predicted a 584 m close approach at 16:55:59 UTC; it was not on the report’s Top Ten list and ranked 152nd at the time of the collision. The collision occurred at 16:55:59 UTC, under two hours after that report.',
    viz: { mode: 'names', groups: [{ prefix: 'IRIDIUM 33 DEB', color: 0x4fd1e0, label: 'Iridium 33 debris' }, { prefix: 'COSMOS 2251 DEB', color: 0xff6b6b, label: 'Cosmos 2251 debris' }] }
  },
  {
    id: 'fengyun', title: 'Fengyun-1C ASAT test', year: '2007',
    tag: 'Largest debris-generating event on record',
    intro: '<strong style="color:var(--accent-warn)">11 January 2007.</strong> China destroyed its own defunct Fengyun-1C weather satellite with a direct-ascent kinetic kill vehicle at ~860 km — the single largest debris-generating event in history. The debris cloud in the 3D view is what remains.',
    steps: [
      { date: '10 May 1999', crit: false, txt: 'Fengyun-1C, a ~960 kg Chinese sun-synchronous weather satellite, is launched from Taiyuan. It works ‘through at least 2005’; by January 2007 it still responds to controllers but no longer provides significant meteorological service.', prob: null },
      { date: '11 Jan 2007 · 22:26 UTC', crit: true, txt: 'A direct-ascent SC-19 kinetic-kill vehicle strikes Fengyun-1C at ~860 km altitude at ~9 km/s, destroying the satellite.', prob: 'Impact · ~8–9 km/s' },
      { date: '17–18 Jan 2007', crit: false, txt: 'Aviation Week first reports the test; the US National Security Council publicly confirms it on 18 January.', prob: null },
      { date: '19–22 Jan 2007', crit: true, txt: 'The US lodges a formal protest, and Japan, Australia, Canada, the UK and others publicly raise concerns; China declines to confirm or deny for 12 days.', prob: 'Diplomatic protests' },
      { date: '23 Jan 2007', crit: false, txt: 'China confirms the test, stating that it ‘was not directed at any country’ and reiterating opposition to the weaponisation of outer space.', prob: null },
      { date: 'Ongoing', crit: true, txt: 'By mid-September 2010 the catalogue held 3,037 fragments (97% still on orbit). CSET (November 2025) reported nearly 2,500 still on orbit — almost 19% of all tracked debris, still the single largest contributor of any event.', prob: '≈2,500 fragments still on orbit (CSET, 2025)' }
    ],
    caption: '<strong>Article IX OST.</strong> The consultation clause of Article IX applies where a State Party ‘has reason to believe’ that an activity or experiment planned by it or its nationals in outer space ‘would cause potentially harmful interference’ with activities of other States Parties. <strong>Fact pattern.</strong> The intercept took place at 22:26 UTC on 11 January 2007. It was first reported publicly by <i>Aviation Week</i> on 17 January and confirmed by the US National Security Council on 18 January; China confirmed the test on 23 January, 12 days after it. The debris was released at ~860 km, where fragments remain in orbit for many years: nearly 2,500 were still on orbit in November 2025.',
    viz: { mode: 'names', groups: [{ prefix: 'FENGYUN 1C DEB', color: 0xffb347, label: 'Fengyun-1C debris' }] }
  },
  {
    id: 'cosmos1408', title: 'Cosmos 1408 ASAT test', year: '2021',
    tag: 'Nudol test · ISS crew took shelter',
    intro: '<strong style="color:var(--accent-warn)">15 November 2021.</strong> Russia destroyed the defunct Cosmos 1408 with a PL-19 Nudol interceptor at ~480 km, forcing the seven-member ISS crew to shelter in their return capsules. Most of the debris was at low altitude and has since re-entered — a sharp contrast with the high-altitude Fengyun-1C cloud.',
    steps: [
      { date: '16 Sep 1982', crit: false, txt: 'Cosmos 1408, a 1,750 kg Soviet Tselina-D electronic-intelligence satellite, is launched; derelict for decades, it has decayed to a 490 × 465 km orbit by 2021.', prob: null },
      { date: '15 Nov 2021 · ~02:47–02:50 UTC', crit: true, txt: 'A Nudol (A-235; US designation PL-19) direct-ascent interceptor launched from Plesetsk strikes Cosmos 1408 in its 490 × 465 km orbit, destroying it — the first satellite destroyed by the Nudol system.', prob: 'Catastrophic breakup · ~480 km' },
      { date: '15 Nov 2021 (same day)', crit: true, txt: 'The seven-member ISS Expedition 66 crew don suits and shelter in their Soyuz and Crew Dragon capsules. The US State Department reports >1,500 trackable debris pieces and hundreds of thousands of smaller fragments.', prob: 'ISS crew sheltered · >1,500 pieces' },
      { date: '7 Mar 2022', crit: false, txt: 'By 7 March 2022 the US catalogue has added 1,604 Cosmos 1408 fragments with unique identifications; the catalogue eventually lists 1,806.', prob: '1,604 catalogued fragments' },
      { date: '7 Dec 2022', crit: false, txt: 'The UN General Assembly adopts Resolution 77/41, calling on States to commit not to conduct destructive direct-ascent ASAT missile tests, by 155 votes to 9 with 9 abstentions (Russia and China against; India abstaining). It is not legally binding.', prob: 'UNGA 77/41 · non-binding' },
      { date: 'By 2025', crit: true, txt: 'Because the intercept was at low altitude, atmospheric drag self-cleaned the cloud: only a handful of Cosmos 1408 fragments still have public element sets — most have re-entered. High-altitude debris (Fengyun-1C) does not clean itself this way.', prob: 'Low-altitude debris self-cleans' }
    ],
    caption: '<strong>Article IX OST.</strong> The consultation clause of Article IX applies where a State Party ‘has reason to believe’ that an activity or experiment planned by it or its nationals in outer space ‘would cause potentially harmful interference’ with activities of other States Parties. <strong>Fact pattern.</strong> The intercept took place at about 02:47–02:50 UTC on 15 November 2021. The same day, the ISS crew sheltered in their return vehicles and the US State Department reported more than 1,500 trackable pieces. By 7 March 2022, 1,604 fragments had been catalogued. On 7 December 2022 the UN General Assembly adopted Resolution 77/41 by 155 votes to 9, with 9 abstentions.',
    viz: { mode: 'names', groups: [{ prefix: 'COSMOS 1408 DEB', color: 0xff6b6b, label: 'Cosmos 1408 debris' }] }
  },
  {
    id: 'luch', title: 'Luch / Olymp GEO proximity ops', year: '2014–26',
    tag: 'Espionage RPO in the GEO ring',
    intro: '<strong style="color:var(--accent-warn)">2014–2026.</strong> Russia’s Olymp-K (often called Luch) repeatedly parked beside Western commercial and military satellites in geostationary orbit, at times within about 10 km; Western officials and analysts assess that it was intercepting their communications, and France called its approach to Athena-Fidus ‘an act of espionage’. The manoeuvres themselves generated no debris. The 3D view isolates its successor Luch-5X against the Intelsat (ITSO) GEO ring; the original Olymp, retired to a graveyard orbit and fragmented in January 2026, is not in the live element-set feed.',
    steps: [
      { date: '27 Sep 2014 · 20:23 UTC', crit: false, txt: 'Russia launches Olymp-K (often called Luch, NORAD 40258) on a Proton-M from Baikonur into geostationary orbit; it is assessed as an FSB/MoD signals-intelligence platform.', prob: null },
      { date: '2015', crit: true, txt: 'From about 4 April, Olymp-K parks for five months at 18.1°W, directly between Intelsat 901 (18°W) and Intelsat 7 (18.2°W), at times within about 10 km of them. Intelsat General calls it ‘not normal behavior’; Intelsat’s attempts to reach the owner directly and through the US Defense Department go unanswered, and JFCC Space says the satellite has come within 5 km of another satellite three times since launch.', prob: '~10 km approach · calls unanswered' },
      { date: '2017', crit: true, txt: 'Olymp-K approaches the Franco-Italian military communications satellite Athena-Fidus — ‘a bit too close’, France later says, ‘so close that one really could believe that it was trying to capture our communications’.', prob: 'Close approach to Athena-Fidus' },
      { date: '7 Sep 2018', crit: true, txt: 'France’s Minister for the Armed Forces, Florence Parly, publicly declares: ‘Trying to listen to one’s neighbor is not only unfriendly. It’s called an act of espionage’ (Defense News translation).', prob: '‘An act of espionage’' },
      { date: '12 Mar 2023', crit: false, txt: 'Russia launches a successor, Luch-5X / Olymp-K-2 (NORAD 55841), widely assessed as a signals-intelligence platform continuing the pattern.', prob: 'Successor Luch-5X on station' },
      { date: 'Oct 2025 – 30 Jan 2026', crit: true, txt: 'The original Olymp (NORAD 40258) is decommissioned and moved to a graveyard orbit above GEO in October 2025 — then on 30 January 2026 at 06:09 UTC it fragments there, observed by Swiss SSA firm s2A systems. Analysts suggest an impact by untracked debris as a possible cause, since internal energy sources should have been vented at retirement; incomplete passivation has not been ruled out.', prob: 'Olymp fragments · suspected debris strike' }
    ],
    caption: '<strong>Article IX OST.</strong> The consultation clause of Article IX applies where a State Party ‘has reason to believe’ that an activity or experiment planned by it or its nationals in outer space ‘would cause potentially harmful interference’ with activities of other States Parties. <strong>Fact pattern.</strong> Olymp-K’s station-keeping beside Intelsat 901 and Intelsat 7, from about April 2015, was reported publicly in October 2015. Its 2017 approach to Athena-Fidus was made public by France on 7 September 2018. The approaches produced no debris; the retired Olymp fragmented in its graveyard orbit on 30 January 2026.',
    viz: { mode: 'geo', norad: 55841, noradColor: 0xff6b6b, ownerCode: 'ITSO', ownerColor: 0x4fd1e0 }
  }
];

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PICK_RADIUS = IS_TOUCH ? 26 : 14; // px — wider hit area for fingers
const DIRECT_RADIUS = IS_TOUCH ? 10 : 5; // px — a click this close is "on" a dot

let scenActiveIdx = 0;
let scenIndex = -1, scenTimer = null;
function curScen() { return SCENARIOS[scenActiveIdx]; }

// -- Three-clocks strip (Task D) -----------------------------------------
function buildThreeClocks() {
  const st = state.stats;
  const starlink = Object.entries(st.constellations || {})
    .filter(([k]) => k.startsWith('Starlink')).reduce((a, [,v]) => a + v, 0);
  const activeTotal = Object.values(st.by_owner_active || {}).reduce((a, v) => a + v, 0);
  const pct = activeTotal ? Math.round(starlink / activeTotal * 100) : 0;
  // Latest FCC-reported six-month manoeuvre count (scenario_facts.md §5.2:
  // 1 Dec 2025 – 31 May 2026 filing, filed 1 Jul 2026): 65,137 + 142,015.
  const MANOEUVRES_6MO = 65137 + 142015;
  const el = $('#threeClocks');
  el.innerHTML = `
    <div class="tclock orbital">
      <h4>Orbital clock</h4>
      <div class="cv">&lt; 1 second</div>
      <div class="cd">Hypervelocity encounter. Closing speeds of ~10–14 km/s for crossing LEO orbits (11.6 km/s in the Iridium/Cosmos collision) collapse the lethal window to under a second.</div>
      <div class="cx">~10–14 km/s closing speed</div>
    </div>
    <div class="tclock machine">
      <h4>Machine clock</h4>
      <div class="cv">Minutes · autonomous</div>
      <div class="cd">${starlink.toLocaleString('en-GB')} Starlink payloads (≈${pct}% of active payloads on orbit) manoeuvre under an onboard, human-out-of-the-loop collision-avoidance system.</div>
      <div class="cx">${MANOEUVRES_6MO.toLocaleString('en-GB')} avoidance manoeuvres in the latest FCC six-month report</div>
    </div>
    <div class="tclock diplo">
      <h4>Diplomatic clock (Art IX)</h4>
      <div class="cv">Undefined</div>
      <div class="cd">Article IX’s consultation clause applies where a State Party ‘has reason to believe’ that an activity ‘would cause potentially harmful interference’ with activities of other States Parties. The Treaty sets no timeline for the consultations it provides for.</div>
      <div class="cx">Trigger: ‘has reason to believe’ · no timeline in the Treaty</div>
    </div>`;
  buildClockScale();
}

function buildClockScale() {
  const lo = 0;                 // 10^0 = 1 s
  const hi = Math.log10(2.6e6); // ~1 month in seconds
  const posOf = (sec) => {
    const p = (Math.log10(sec) - lo) / (hi - lo);
    return Math.max(0, Math.min(100, p * 100));
  };
  const marks = [
    { sec: 1, label: 'Orbital', val: '~1 s', color: 'var(--accent)' },
    { sec: 180, label: 'Machine', val: '~minutes', color: 'var(--accent-amber)' },
    { sec: 2.6e6, label: 'Diplomatic', val: 'months / undefined', color: 'var(--accent-warn)' }
  ];
  const el = $('#clockScale');
  el.innerHTML = `
    <div class="ls-cap">Decision tempo · log scale</div>
    <div class="ls-track">
      ${marks.map(m => `<span class="ls-mark" style="left:${posOf(m.sec)}%;background:${m.color};box-shadow:0 0 8px ${m.color}"></span>`).join('')}
    </div>
    <div class="ls-labels">
      ${marks.map((m, i) => {
        const p = posOf(m.sec);
        let pos = `left:${p}%;transform:translateX(-50%);text-align:center`;
        if (i === 0) pos = `left:0;transform:none;text-align:left`;
        else if (i === marks.length - 1) pos = `right:0;left:auto;transform:none;text-align:right`;
        return `<div class="ls-lab" style="${pos};color:${m.color}"><span class="v">${m.val}</span>${m.label}</div>`;
      }).join('')}
    </div>`;
}

// -- Scenario selector + copy (Task C) -----------------------------------
function buildScenarioCards() {
  const el = $('#scenCards');
  el.innerHTML = SCENARIOS.map((s, i) => `
    <button class="scen-card ${i === scenActiveIdx ? 'active' : ''}" data-scen="${i}">
      <div class="sc-year">${s.year}</div>
      <div class="sc-title">${s.title}</div>
      <div class="sc-tag">${s.tag}</div>
    </button>`).join('');
  $$('#scenCards .scen-card').forEach(b => b.addEventListener('click', () => selectScenario(parseInt(b.dataset.scen))));
}

function selectScenario(idx) {
  if (idx === scenActiveIdx && state._scenBuilt) return;
  if (histMode) histExit();
  if (scenVizOn) toggleScenViz();
  scenActiveIdx = idx;
  state._scenBuilt = true;
  $$('#scenCards .scen-card').forEach((b, k) => b.classList.toggle('active', k === idx));
  const s = curScen();
  $('#scenIntro').innerHTML = s.intro;
  $('#scenCaption').innerHTML = s.caption;
  const hb = $('#scenHist');
  if (hb) hb.style.display = HIST_IDS.has(s.id) ? '' : 'none';
  buildScenario();
  updateScenNow();
  updateScenVizButton();
}

function buildScenario() {
  const steps = curScen().steps;
  const el = $('#scenTimeline');
  el.innerHTML = steps.map((s, i) => `
    <div class="tl-step ${s.crit?'crit':''}" data-i="${i}">
      <div class="tl-dot">${i+1}</div>
      <div class="tl-body">
        <div class="tl-date">${s.date}</div>
        <div class="tl-txt">${s.txt}</div>
        ${s.prob ? `<div class="tl-prob">${s.prob}</div>` : ''}
      </div>
    </div>`).join('');
  el.querySelectorAll('.tl-step').forEach(st => st.addEventListener('click', () => {
    if (scenTimer) { clearInterval(scenTimer); scenTimer = null; $('#scenPlay').textContent = '▶ Replay sequence'; }
    scenStep(parseInt(st.dataset.i, 10));
  }));
  scenIndex = -1;
  $('#scenProg').style.width = '0%';
  if (scenTimer) { clearInterval(scenTimer); scenTimer = null; $('#scenPlay').textContent = '▶ Replay sequence'; }
}

function scenStep(i) {
  scenIndex = i;
  const n = curScen().steps.length;
  $$('#scenTimeline .tl-step').forEach((el, k) => {
    el.classList.toggle('on', k <= i);
    el.classList.toggle('cur', k === i);
  });
  $('#scenProg').style.width = (Math.max(0, i + 1) / n * 100) + '%';
  const cur = $('#scenTimeline .tl-step.cur');
  if (cur && scenTimer) {
    // Scroll only the drawer body — scrollIntoView would also scroll the fixed
    // page layout's ancestors, which shifts the whole UI off-screen.
    const body = cur.closest('.drawer-body');
    if (body) {
      const cr = cur.getBoundingClientRect(), br = body.getBoundingClientRect();
      if (cr.top < br.top + 8) body.scrollBy({ top: cr.top - br.top - 8, behavior: 'smooth' });
      else if (cr.bottom > br.bottom - 8) body.scrollBy({ top: cr.bottom - br.bottom + 8, behavior: 'smooth' });
    }
  }
  updateScenNow();
}
// Event chip over the 3D scene — narrates the active step while isolation is on.
function updateScenNow() {
  const chip = $('#scenNow');
  if (!chip) return;
  if (histMode) { chip.style.display = 'none'; return; }
  const s = (scenIndex >= 0) ? curScen().steps[scenIndex] : null;
  if (scenVizOn && s) {
    chip.innerHTML = `<span class="sn-k">${curScen().title}</span><span class="sn-d">${s.date}</span>${s.prob ? `<span class="sn-p">${s.prob}</span>` : ''}`;
    chip.style.display = 'flex';
  } else if (scenVizOn) {
    // Isolation on but no step active yet — identify the scene.
    chip.innerHTML = `<span class="sn-k">${curScen().title}</span><span class="sn-d">${curScen().year}</span>`;
    chip.style.display = 'flex';
  } else {
    chip.style.display = 'none';
  }
}

function scenPlay() {
  if (histMode) histExit();
  const n = curScen().steps.length;
  if (scenTimer) { // second press = pause
    clearInterval(scenTimer); scenTimer = null;
    $('#scenPlay').textContent = '▶ Resume';
    return;
  }
  let i = (scenIndex >= 0 && scenIndex < n - 1) ? scenIndex : -1;
  $('#scenPlay').textContent = '⏸ Playing…';
  const advance = () => {
    i++;
    scenStep(i);
    if (i >= n - 1) { clearInterval(scenTimer); scenTimer = null; $('#scenPlay').textContent = '↻ Replay sequence'; }
  };
  advance(); // first step immediately — no dead delay
  scenTimer = setInterval(advance, 2200);
  // Playing means watching: bring up the 3D isolation automatically on
  // desktop, where the timeline stays readable beside the scene.
  if (!scenVizOn && curScen().viz && !window.matchMedia('(max-width: 820px)').matches) toggleScenViz();
}

function updateScenVizButton() {
  const btn = $('#scenViz');
  if (btn) btn.textContent = scenVizOn ? 'Hide 3D isolation' : 'Show orbits in 3D';
}

// -- 3D isolation view (Task C) ------------------------------------------
let scenVizOn = false;
function toggleScenViz() {
  if (histMode) histExit();
  scenVizOn = !scenVizOn;
  const note = $('#scenVizNote');
  if (scenVizOn) {
    // Isolation views are read at close range — a leftover 600×/3600× clock
    // makes the pair whirl unwatchably, so settle back to real time.
    if (state.speed > 60) setSpeed(1); // multiplier only — play state untouched
    const built = buildScenIsolation(curScen().viz);
    state._scenGroups = built.groups;
    state._scenIsolate = built.all;      // kept for compatibility / QA
    isolateScenario(true);
    note.innerHTML = built.note;
    note.style.display = 'block';
    // Keep the timeline readable beside the 3D view on desktop; on small
    // screens the drawer covers the scene, so close it there.
    if (window.matchMedia('(max-width: 820px)').matches) closeDrawer();
    controls.target.set(0, 0, 0);
    camera.position.set(built.cam[0], built.cam[1], built.cam[2]);
    if (built.orbitPair) requestScenarioOrbits(built.orbitPair);
    else clearScenarioOrbits();
  } else {
    state._scenGroups = null;
    state._scenIsolate = null;
    isolateScenario(false);
    clearScenarioOrbits();
    note.style.display = 'none';
  }
  updateScenNow();
  updateScenVizButton();
}

// Resolve a scenario's viz descriptor into concrete catalog indices, colors,
// camera position and an honest note — all computed from the live catalog.
function buildScenIsolation(viz) {
  const N = state.N;
  if (viz.mode === 'pair') {
    const pair = pickIllustrativePair();
    const groups = [];
    if (pair[0] >= 0) groups.push({ indices: new Set([pair[0]]), color: 0x4fd1e0 });
    if (pair[1] >= 0) groups.push({ indices: new Set([pair[1]]), color: 0xff6b6b });
    return {
      groups, all: pair, cam: [9, 7, 20], orbitPair: pair.length >= 2 ? pair : null,
      note: '<strong>Illustrative.</strong> Starlink-44 (2019-029AV, NORAD 44278 — listed in today’s SATCAT as STARLINK-67) decayed in May 2020 and Aeolus (NORAD 43600) was de-orbited in July 2023, so neither is in the current catalogue. The 3D view shows a representative present-day Starlink alongside a sun-synchronous Earth-observation payload to convey the crossing geometry. For the actual 2019 objects propagated from archival element sets, press “⏱ Replay the event”.'
    };
  }
  if (viz.mode === 'names') {
    const groups = [];
    const parts = [];
    for (const g of viz.groups) {
      const set = new Set();
      for (let i = 0; i < N; i++) if (state.name[i] && state.name[i].startsWith(g.prefix)) set.add(i);
      groups.push({ indices: set, color: g.color });
      const hex = '#' + g.color.toString(16).padStart(6, '0');
      parts.push(`<span style="color:${hex}">${set.size.toLocaleString('en-GB')}</span> ${g.label}`);
    }
    let note = `<strong>Live catalogue.</strong> Isolating ${parts.join(' and ')} — objects with public element sets still on orbit today. `;
    if (viz.groups[0].prefix.startsWith('COSMOS 1408')) {
      note += 'Only a handful of Cosmos 1408 fragments still have public element sets: because the intercept was at low altitude (~480 km), atmospheric drag has re-entered nearly all of the cloud. High-altitude debris (e.g. Fengyun-1C) does not self-clean this way.';
    } else {
      note += 'These are the fragments the event left behind — the debris cloud itself is the visual record of the collision.';
    }
    const all = [...groups.reduce((a, g) => { g.indices.forEach(x => a.add(x)); return a; }, new Set())];
    return { groups, all, cam: [9, 7, 20], orbitPair: null, note };
  }
  if (viz.mode === 'geo') {
    const luch = new Set(), itso = new Set();
    for (let i = 0; i < N; i++) {
      if (state.norad[i] === viz.norad) luch.add(i);
      if (state.ownerCode[i] === viz.ownerCode) itso.add(i);
    }
    const groups = [
      { indices: luch, color: viz.noradColor },
      { indices: itso, color: viz.ownerColor }
    ];
    const all = [...new Set([...luch, ...itso])];
    const luchHex = '#' + viz.noradColor.toString(16).padStart(6, '0');
    const itsoHex = '#' + viz.ownerColor.toString(16).padStart(6, '0');
    const luchName = luch.size ? 'Luch-5X (Olymp-K 2)' : 'the Luch successor';
    const note = `<strong>Live catalogue · GEO ring.</strong> <span style="color:${luchHex}">${luchName}</span> (NORAD ${viz.norad}) is isolated against the <span style="color:${itsoHex}">${itso.size} Intelsat (ITSO) GEO payloads</span> it and its predecessor shadowed. The original Olymp (NORAD 40258) is no longer intact — it was moved to a graveyard orbit in October 2025 and fragmented there on 30 January 2026, possibly struck by untracked debris, and it is not in the live element-set feed, so it cannot be shown here.`;
    return { groups, all, cam: [0, 20, 55], orbitPair: null, note };
  }
  return { groups: [], all: [], cam: [9, 7, 20], orbitPair: null, note: '' };
}

// Pick two representative LEO objects: a Starlink (stand-in for Starlink-44) and
// a polar/sun-synchronous Earth-observation-like sat (stand-in for Aeolus).
function pickIllustrativePair() {
  let star = -1, eo = -1;
  for (let i = 0; i < state.N; i++) {
    if (!state.lastAlive[i] || state.regime[i] !== 0) continue;
    if (star < 0 && constKey(state.constLabel[i]) === 'Starlink') star = i;
    if (eo < 0 && state.objType[i] === 'PAY' && state.constLabel[i] === '') {
      const inc = parseFloat(state.tle2[i].substring(8, 16));
      const yr = parseInt(state.launchYear[i]);
      if (inc > 96 && inc < 99.5 && yr >= 2015) eo = i;
    }
    if (star >= 0 && eo >= 0) break;
  }
  state._scenLabels = {};
  if (eo >= 0) state._scenLabels[eo] = 'AEOLUS (illustrative)';
  if (star >= 0) state._scenLabels[star] = 'STARLINK (illustrative)';
  return [eo, star].filter(x => x >= 0);
}

function isolateScenario(on) {
  const N = state.N, ca = colorAttr.array, sa = sizeAttr.array;
  if (on && state._scenGroups && state._scenGroups.length) {
    const colorByIdx = new Map();
    for (const g of state._scenGroups) g.indices.forEach(i => colorByIdx.set(i, g.color));
    const isoSize = colorByIdx.size > 200 ? 2.4 : 5.0;
    for (let i = 0; i < N; i++) {
      if (colorByIdx.has(i)) {
        _c.setHex(colorByIdx.get(i));
        ca[i*3]=_c.r; ca[i*3+1]=_c.g; ca[i*3+2]=_c.b; sa[i]=isoSize;
      } else { ca[i*3]=0; ca[i*3+1]=0; ca[i*3+2]=0; sa[i]=0; }
    }
    colorAttr.needsUpdate = true; sizeAttr.needsUpdate = true;
    const vc = $('#visibleCount');
    if (vc) vc.textContent = colorByIdx.size.toLocaleString() + ' scenario objects isolated';
  } else {
    updateColors();
    const vc = $('#visibleCount');
    if (vc) vc.textContent = visibleCount.toLocaleString() + ' / ' + state.N.toLocaleString() + ' objects shown';
  }
}

let scenOrbitLines = [];
let _scenPairForOrbit = null;
function requestScenarioOrbits(pair) {
  if (!workerReady || pair.length < 2) return;
  _scenPairForOrbit = pair;
  const t0 = state.simTime;
  const times = [];
  const span = 95 * 60 * 1000; // 95 min
  for (let k = 0; k <= 120; k++) times.push(t0 + (k / 120) * span);
  worker.postMessage({ type: 'track', indices: pair, times, tag: 'scen' });
}
function clearScenarioOrbits() {
  scenOrbitLines.forEach(l => { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
  scenOrbitLines = [];
  _scenPairForOrbit = null;
}
function drawScenarioOrbits() {
  scenOrbitLines.forEach(l => { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
  scenOrbitLines = [];
  if (!state.scenarioTracks || !_scenPairForOrbit) return;
  const colors = [0x4fd1e0, 0xff6b6b]; // eo, star
  state.scenarioTracks.forEach((track, ti) => {
    const n = track.length / 3;
    const pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      pts[k*3]   = track[k*3]   * SCALE;
      pts[k*3+1] = track[k*3+2] * SCALE;
      pts[k*3+2] = -track[k*3+1] * SCALE;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: colors[ti] || 0xffffff, transparent: true, opacity: 0.75 });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false;
    scene.add(line);
    scenOrbitLines.push(line);
  });
}

// ============================================================
// 11a½. Historical event replay — archival element sets
// ============================================================
// Replays each case study on the globe from archival US SSN general-
// perturbations element sets (data/histevents.json, static, validated at
// build — see pipeline/build_histevents.py). SGP4-propagated in the browser
// with satellite.js; Earth rotation and the solar terminator follow the
// historical clock automatically.
const HIST_IDS = new Set(['aeolus', 'iridium', 'fengyun', 'cosmos1408', 'luch']);
let histData = null, histMode = null, _satLibP = null;

function loadSatLib() {
  if (self.satellite) return Promise.resolve();
  if (!_satLibP) _satLibP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './js/satellite.min.js?v=' + appVersion(); s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return _satLibP;
}
async function loadHistData() {
  if (!histData) histData = await (await fetch('./data/histevents.json?v=' + appVersion())).json();
  return histData;
}

function _glowTex(hex) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, hex); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function _labelSprite(text, hex) {
  const fs = 26, pad = 10;
  const m = document.createElement('canvas').getContext('2d');
  m.font = `600 ${fs}px "IBM Plex Mono", monospace`;
  const w = Math.ceil(m.measureText(text).width) + pad * 2;
  const c = document.createElement('canvas'); c.width = w; c.height = fs + pad * 1.6;
  const x = c.getContext('2d');
  x.font = `600 ${fs}px "IBM Plex Mono", monospace`;
  x.fillStyle = 'rgba(7,11,18,0.78)'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = hex; x.globalAlpha = 0.5; x.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  x.globalAlpha = 1; x.fillStyle = hex; x.textBaseline = 'middle';
  x.fillText(text, pad, c.height / 2 + 1);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  return { spr, aspect: c.width / c.height };
}

function histPick(recs, jd) {
  let r = recs[0];
  for (const c of recs) { if (c.jdsatepoch <= jd) r = c; else break; }
  return r;
}
function histMid(H) {
  const v = new THREE.Vector3(); let n = 0;
  for (const o of H.objs) { v.add(o.pos); n++; }
  return n ? v.multiplyScalar(1 / n) : v;
}
function histPropagate(H, tMs) {
  const S = self.satellite;
  const d = new Date(tMs);
  const jd = tMs / 86400000 + 2440587.5;
  H.gmst = S.gstime(d);
  for (const o of H.objs) {
    if (o.dead) continue;
    try {
      const pv = S.propagate(histPick(o.recs, jd), d);
      if (pv && pv.position) {
        o.pos.set(pv.position.x * SCALE, pv.position.z * SCALE, -pv.position.y * SCALE);
        if (pv.velocity) o.eciV = pv.velocity; // km/s ECI — needed for breakup state
        o.eciR = pv.position;                  // km ECI
        o.grp.position.copy(o.pos);
        o.grp.visible = true;
      }
    } catch (e) { /* propagation edge — keep last position */ }
  }
  if (H.objs.length === 2) H.sepKm = H.objs[0].pos.distanceTo(H.objs[1].pos) * 1000;
}
function histTimeOf(H, p) {
  const slow = (H.ev.slowFinalMin || 0) * 60000;
  const a = H.keyT - slow;
  if (!slow || a <= H.t0) return H.t0 + p * (H.t1 - H.t0);
  const cf = H.ev.codaFrac || 0.10;          // share of runtime after the key moment
  const pPre = 1 - 0.35 - cf;                // approach · slow-motion · coda
  if (p < pPre) {
    if (H.chapters) {
      // Documentary chapters: dwell calmly at each pre-event milestone with a
      // hard cut between them, instead of a continuous fast-forward that spins
      // the Earth like a strobe over multi-day windows.
      const C = H.chapters.length;
      const q = Math.min(C - 1e-9, (p / pPre) * C);
      const c = Math.floor(q);
      H._chNow = c;
      const dwellSimMs = (pPre * H.ev.durationSec / C) * 1000 * H.chRate;
      return H.chapters[c] + (q - c) * dwellSimMs;
    }
    H._chNow = -1;
    return H.t0 + (p / pPre) * (a - H.t0);
  }
  H._chNow = 'S'; // slow-motion / coda — continuous time from here on
  if (p < pPre + 0.35) return a + ((p - pPre) / 0.35) * (H.keyT - a);
  return H.keyT + ((p - pPre - 0.35) / cf) * (H.t1 - H.keyT);
}

// ---- Debris cloud: one particle per catalogued fragment ----------------
// Fragments are released from the object's true breakup state vector (SGP4
// from archival element sets), given an isotropic modelled velocity spread
// (log-normal, tens of m/s — NASA standard-breakup-model magnitudes), and
// propagated individually by two-body Kepler dynamics. This shows the real
// mechanics — spreading along-track into a ring on the parent's orbital
// plane — without claiming to be the catalogued fragment orbits.
const _MU = 398600.4418; // km^3/s^2
const _YUP = new THREE.Vector3(0, 1, 0); // scene spin axis (ECI z maps to scene +Y)
function _makeCloud(o, tMs, hex) {
  const S = self.satellite;
  const d = new Date(tMs);
  let pv;
  try { pv = S.propagate(histPick(o.recs, tMs / 86400000 + 2440587.5), d); } catch (e) { return null; }
  if (!pv || !pv.position || !pv.velocity) return null;
  const R = pv.position, V = pv.velocity;
  const N = Math.max(0, o.fragments | 0);
  if (!N) return null;
  const hot = histMode && histMode.ev.kind === 'asat';
  const med = hot ? 0.065 : 0.05, cap = hot ? 0.5 : 0.35; // km/s
  const a_ = new Float32Array(N), e_ = new Float32Array(N), n_ = new Float32Array(N),
        M_ = new Float32Array(N), P_ = new Float32Array(N * 3), Q_ = new Float32Array(N * 3);
  let m = 0;
  for (let i = 0; i < N; i++) {
    for (let tries = 0; tries < 4; tries++) {
      // isotropic direction, log-normal magnitude
      const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const mag = Math.min(cap, med * Math.exp(0.85 * _gauss()));
      const vx = V.x + mag * s * Math.cos(ph), vy = V.y + mag * s * Math.sin(ph), vz = V.z + mag * u;
      const r = Math.hypot(R.x, R.y, R.z), v2 = vx * vx + vy * vy + vz * vz;
      const aa = 1 / (2 / r - v2 / _MU); // vis-viva
      if (aa <= 0) continue;             // hyperbolic — resample
      // eccentricity vector
      const rv = R.x * vx + R.y * vy + R.z * vz;
      const c1 = v2 / _MU - 1 / r, c2 = rv / _MU;
      const ex = c1 * R.x - c2 * vx, ey = c1 * R.y - c2 * vy, ez = c1 * R.z - c2 * vz;
      const ee = Math.hypot(ex, ey, ez);
      if (ee > 0.92 || aa * (1 - ee) < EARTH_R + 60) continue; // sub-surface perigee — resample
      // perifocal basis: P = periapsis dir, Q = W x P
      const hx = R.y * vz - R.z * vy, hy = R.z * vx - R.x * vz, hz = R.x * vy - R.y * vx;
      const hn = Math.hypot(hx, hy, hz);
      let px, py, pz;
      if (ee > 1e-6) { px = ex / ee; py = ey / ee; pz = ez / ee; }
      else { px = R.x / r; py = R.y / r; pz = R.z / r; }
      const wx = hx / hn, wy = hy / hn, wz = hz / hn;
      const qx = wy * pz - wz * py, qy = wz * px - wx * pz, qz = wx * py - wy * px;
      const esE = rv / Math.sqrt(_MU * aa), ecE = 1 - r / aa;
      const E0 = Math.atan2(esE, ecE);
      a_[m] = aa; e_[m] = ee; n_[m] = Math.sqrt(_MU / (aa * aa * aa));
      M_[m] = E0 - esE;
      P_[m * 3] = px; P_[m * 3 + 1] = py; P_[m * 3 + 2] = pz;
      Q_[m * 3] = qx; Q_[m * 3 + 1] = qy; Q_[m * 3 + 2] = qz;
      m++; break;
    }
  }
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(m * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: new THREE.Color(hex), size: 2.2, sizeAttenuation: false,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, pos, n: m, t0: tMs, born: performance.now(), a: a_, e: e_, mm: n_, M0: M_, P: P_, Q: Q_ };
}
let _g2 = null;
function _gauss() { // Box–Muller with spare
  if (_g2 !== null) { const g = _g2; _g2 = null; return g; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
  _g2 = r * Math.sin(th);
  return r * Math.cos(th);
}
function _cloudUpdate(C, tMs) {
  const dt = (tMs - C.t0) / 1000; // seconds since breakup
  const pos = C.pos;
  for (let i = 0; i < C.n; i++) {
    const e = C.e[i], a = C.a[i];
    let E = C.M0[i] + C.mm[i] * dt;
    const M = E;
    for (let k = 0; k < 5; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const X = C.P[i * 3] * x + C.Q[i * 3] * y,
          Y = C.P[i * 3 + 1] * x + C.Q[i * 3 + 1] * y,
          Z = C.P[i * 3 + 2] * x + C.Q[i * 3 + 2] * y;
    pos[i * 3] = X * SCALE; pos[i * 3 + 1] = Z * SCALE; pos[i * 3 + 2] = -Y * SCALE;
  }
  C.pts.geometry.attributes.position.needsUpdate = true;
  // fade in over ~1.8 s of real time
  C.pts.material.opacity = Math.min(0.85, (performance.now() - C.born) / 1800 * 0.85);
}

function histStart(evId) {
  const ev = histData.events[evId]; if (!ev || !self.satellite) return;
  if (histMode) histExit();
  if (scenVizOn) toggleScenViz();
  if (window.matchMedia('(max-width: 820px)').matches) closeDrawer();
  const S = self.satellite;
  const t0 = Date.parse(ev.window[0]), t1 = Date.parse(ev.window[1]);
  const keyT = Date.parse(ev.keyTime);
  const objs = ev.objects.map(oc => {
    const recs = oc.tles.map(t => { try { return S.twoline2satrec(t[0], t[1]); } catch (e) { return null; } })
      .filter(r => r && !r.error).sort((a, b) => a.jdsatepoch - b.jdsatepoch);
    const grp = new THREE.Group();
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex(oc.color), transparent: true, depthWrite: false }));
    grp.add(marker);
    const lab = _labelSprite(oc.name, oc.color);
    const tl = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: new THREE.Color(oc.color), transparent: true, opacity: 0.55 }));
    tl.frustumCulled = false;
    scene.add(grp); scene.add(lab.spr); scene.add(tl);
    return { ...oc, recs, grp, marker, label: lab.spr, labAspect: lab.aspect,
             trailLine: tl, trail: [], lastTrail: 0, pos: new THREE.Vector3(), dead: false };
  });
  let sepLine = null;
  if (objs.length === 2) {
    sepLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0 }));
    sepLine.frustumCulled = false; sepLine.visible = false; scene.add(sepLine);
  }
  histMode = { id: evId, ev, t0, t1, keyT, objs, sepLine,
    p: 0, paused: false, done: false, fired: false, gmst: 0, sepKm: null,
    saved: { speed: state.speed, playing: state.playing },
    ms: (ev.milestones || []).map(m => ({ t: Date.parse(m.t), step: m.step })).sort((a, b) => a.t - b.t),
    msIdx: 0, lastHud: 0, userCam: false, flash: null,
    trailMax: ev.kind === 'rpo' ? 1600 : 800, camDist: 0, camDir: null };
  // A replay always begins playing — reflect that on the shared play control
  // (without touching state.playing, which is restored on exit).
  { const pp = $('#playPath'); if (pp) pp.setAttribute('d', ICON_PAUSE); }
  // Chapters: when the pre-event window would need a >2500× continuous
  // time-lapse (Earth strobing several revolutions), replay it instead as calm
  // dwells at each milestone (≈48×) with clean cuts between them.
  {
    const _slow = (ev.slowFinalMin || 0) * 60000;
    const _a = keyT - _slow;
    if (_slow && _a > t0) {
      const _cf = ev.codaFrac || 0.10;
      const _pPre = 1 - 0.35 - _cf;
      const rate = (_a - t0) / (_pPre * ev.durationSec * 1000);
      if (rate > 2500) {
        histMode.chapters = [t0, ...histMode.ms.map(m => m.t).filter(mt => mt > t0 + 60000 && mt < _a - 120000)];
        histMode.chRate = 48;
      }
    }
  }
  if (points) points.visible = false;
  selMarker.visible = false; clearSelOrbit();
  if (ev.preSteps && ev.preSteps.length) scenStep(ev.preSteps[ev.preSteps.length - 1]);
  histPropagate(histMode, t0);
  // Camera follows the primary object (first in the event's object list) at a
  // distance that keeps the whole Earth comfortably in frame.
  const lead = histMode.objs[0].pos;
  const r = Math.max(lead.length(), RE_SCENE + 0.4);
  histMode.camDist = r + (r > 20 ? 22 : 13);
  // Start from the camera's current bearing and swing smoothly toward the
  // primary object; the radius is held constant so the camera orbits, never
  // cutting a chord through the near-Earth region.
  histMode.camDir = camera.position.lengthSq() > 0.01 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
  controls.target.set(0, 0, 0);
  controls.addEventListener('start', histCamGrab);
  document.body.classList.add('hist-run');
  $('#hhTitle').textContent = `${curScen().title} · ${curScen().year}`;
  $('#hhDone').style.display = 'none';
  $('#hhCount').textContent = '';
  $('#histHud').style.display = 'block';
  const hb = $('#scenHist'); if (hb) hb.textContent = '⟳ Restart replay';
  updateScenNow();
}
function histCamGrab() { if (histMode) histMode.userCam = true; }

function histFire() {
  const H = histMode; H.fired = true;
  const at = H.objs.length === 2 ? histMid(H) : H.objs[0].pos.clone();
  const kind = H.ev.kind;
  const col = kind === 'collision' || kind === 'asat' ? '#ff5a5a'
            : kind === 'conjunction' ? '#ffd76a' : '#9ad1ff';
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex(col), transparent: true, depthWrite: false }));
  spr.position.copy(at); scene.add(spr);
  H.flash = { spr, t0: performance.now() };
  if (kind === 'collision' || kind === 'asat') {
    H.debris = [];
    for (const o of H.objs) {
      o.dead = true;
      o.marker.material.opacity = 0.3;
      o.trailLine.material.opacity = 0.22;
      const cloud = _makeCloud(o, H.keyT, o.color);
      if (cloud) H.debris.push(cloud);
    }
    if (H.sepLine) H.sepLine.visible = false;
  }
}
function histFinish() {
  const H = histMode; H.done = true;
  $('#hhDoneLabel').textContent = H.ev.keyLabel;
  $('#hhDone').style.display = 'flex';
}

function _fmtDur(s) {
  const p = (n) => String(n).padStart(2, '0');
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${p(Math.floor(s % 86400 / 3600))}h`;
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(Math.floor(s % 60))}`;
}
function _fmtKm(km) {
  return km < 100 ? km.toFixed(1) + ' km' : Math.round(km).toLocaleString('en-GB') + ' km';
}
const _KIND_WORD = { collision: 'collision', asat: 'intercept', conjunction: 'closest approach', rpo: 'minimum separation' };
function histHud(t) {
  const H = histMode;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  $('#hhClock').textContent = `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
  let line;
  if (t < H.keyT) line = `T–${_fmtDur((H.keyT - t) / 1000)} to ${_KIND_WORD[H.ev.kind] || 'event'}`;
  else if (H.debris && H.debris.length) {
    const tot = H.debris.reduce((s, C) => s + C.n, 0);
    line = `Debris cloud forming — ${tot.toLocaleString('en-GB')} catalogued fragments, one particle each`;
  } else line = H.ev.keyLabel;
  if (H.sepKm != null && !H.objs.some(o => o.dead) && (t < H.keyT || H.ev.kind === 'rpo')) line += ` · separation ${_fmtKm(H.sepKm)}`;
  $('#hhCount').textContent = line;
}

function histTick(dt, now) {
  const H = histMode;
  if (!H.paused && !H.done) {
    H.p = Math.min(1, H.p + dt / H.ev.durationSec);
    if (H.p >= 1) histFinish();
  }
  const t = histTimeOf(H, H.p);
  // Detect a chapter cut (or the cut into slow-motion) so trails don't streak
  // across the jump and the camera snaps rather than swirling.
  const cut = H.chapters !== undefined && H._chPrev !== undefined && H._chNow !== H._chPrev;
  H._chPrev = H._chNow;
  state.simTime = t;
  histPropagate(H, t);
  if (cut) for (const o of H.objs) { o.trail.length = 0; o.trailLine.geometry.setFromPoints([]); }
  while (H.msIdx < H.ms.length && t >= H.ms[H.msIdx].t) { scenStep(H.ms[H.msIdx].step); H.msIdx++; }
  if (!H.fired && t >= H.keyT) histFire();
  for (const o of H.objs) {
    const dd = camera.position.distanceTo(o.pos);
    const pulse = 1 + 0.14 * Math.sin(now * 0.005);
    o.marker.scale.setScalar(dd * (o.dead ? 0.02 : 0.035) * pulse);
    const lh = dd * 0.03;
    o.label.scale.set(lh * o.labAspect, lh, 1);
    o.label.position.copy(o.pos); o.label.position.y += dd * 0.05;
    if (!o.dead && now - o.lastTrail > 50) {
      o.trail.push(o.pos.clone());
      if (o.trail.length > H.trailMax) o.trail.shift();
      o.trailLine.geometry.setFromPoints(o.trail);
      o.lastTrail = now;
    }
  }
  if (H.sepLine && !H.objs.some(o => o.dead)) {
    const thr = H.ev.kind === 'rpo' ? 60000 : 4000;
    if (H.sepKm < thr) {
      H.sepLine.geometry.setFromPoints([H.objs[0].pos, H.objs[1].pos]);
      const k = 1 - H.sepKm / thr;
      H.sepLine.material.opacity = 0.15 + 0.6 * k;
      H.sepLine.material.color.setHSL(0.52 - 0.52 * k, 0.85, 0.62);
      H.sepLine.visible = true;
    } else H.sepLine.visible = false;
  }
  if (H.debris) for (const C of H.debris) _cloudUpdate(C, t);
  if (H.flash) {
    const k = (now - H.flash.t0) / 1600;
    if (k >= 1) { scene.remove(H.flash.spr); H.flash.spr.material.dispose(); H.flash = null; }
    else {
      const dd = camera.position.distanceTo(H.flash.spr.position);
      H.flash.spr.scale.setScalar(dd * (0.05 + k * 0.4));
      H.flash.spr.material.opacity = 1 - k;
    }
  }
  if (!H.userCam) {
    // For GEO proximity events the camera co-rotates with the Earth, so the
    // planet and the geostationary belt hold still while months of drift play
    // out — instead of the whole scene strobing through dozens of rotations.
    if (H.ev.kind === 'rpo' && H._pg !== undefined) {
      let dg = H.gmst - H._pg;
      if (dg > Math.PI) dg -= 2 * Math.PI; else if (dg < -Math.PI) dg += 2 * Math.PI;
      H.camDir.applyAxisAngle(_YUP, dg);
    }
    H._pg = H.gmst;
    const lead = H.objs[0].pos;
    if (lead.lengthSq() > 1) {
      if (cut) H.camDir.copy(lead).normalize(); // hard cut — snap, don't swirl
      const k = 1 - Math.exp(-dt * 2.2); // frame-rate independent chase
      H.camDir.lerp(lead.clone().normalize(), k).normalize();
      camera.position.copy(H.camDir).multiplyScalar(H.camDist);
    }
  }
  if (now - H.lastHud > 200) { histHud(t); H.lastHud = now; }
}

function histExit() {
  if (!histMode) return;
  const H = histMode; histMode = null;
  controls.removeEventListener('start', histCamGrab);
  for (const o of H.objs) {
    scene.remove(o.grp); scene.remove(o.label); scene.remove(o.trailLine);
    if (o.marker.material.map) o.marker.material.map.dispose();
    o.marker.material.dispose();
    if (o.label.material.map) o.label.material.map.dispose();
    o.label.material.dispose();
    o.trailLine.geometry.dispose(); o.trailLine.material.dispose();
  }
  if (H.sepLine) { scene.remove(H.sepLine); H.sepLine.geometry.dispose(); H.sepLine.material.dispose(); }
  if (H.flash) { scene.remove(H.flash.spr); H.flash.spr.material.dispose(); }
  if (H.debris) for (const C of H.debris) { scene.remove(C.pts); C.pts.geometry.dispose(); C.pts.material.dispose(); }
  if (points) points.visible = true;
  // Restore exactly the play state and multiplier the viewer had before the
  // replay — a paused clock stays paused — and resync the icon and chips.
  setSpeed(H.saved.speed); setPlaying(H.saved.playing);
  state.simTime = Date.now();
  document.body.classList.remove('hist-run');
  $('#histHud').style.display = 'none';
  const hb = $('#scenHist'); if (hb) hb.textContent = '⏱ Replay the event · archival orbits';
  updateScenNow();
}

// ============================================================
// 11b. Registration Lag Index (Phase 2 · Task A)
// ============================================================
// Reads site/data/lag.json — a live longitudinal dataset that begins
// accumulating the day the instrument goes live. On day one there is nothing
// to report yet, so the section renders an honest empty state and shows the
// running population it is watching. Nothing is hardcoded.
function buildLagIndex() {
  const lag = state.lag;
  const statsEl = $('#lagStats');
  const methodEl = $('#lagMethod');
  const flipsEl = $('#lagFlips');
  if (!lag) {
    if (statsEl) statsEl.innerHTML = '';
    if (methodEl) methodEl.textContent = 'Registration Lag Index dataset unavailable.';
    if (flipsEl) flipsEl.innerHTML = '';
    return;
  }
  const median = lag.median_lag_days == null
    ? '<span class="accrue">accruing…</span>'
    : lag.median_lag_days.toLocaleString('en-GB') + '<span class="l" style="display:inline"> days</span>';
  statsEl.innerHTML = `
    <div class="stat-cell"><div class="n">${(lag.tracked_payloads||0).toLocaleString('en-GB')}</div><div class="l">Payloads tracked</div></div>
    <div class="stat-cell"><div class="n">${(lag.watching_unregistered||0).toLocaleString('en-GB')}</div><div class="l">No matching UN record — under watch</div></div>
    <div class="stat-cell"><div class="n">${(lag.flips_observed||0).toLocaleString('en-GB')}</div><div class="l">Registrations observed since launch of this index</div></div>
    <div class="stat-cell"><div class="n">${median}</div><div class="l">Median observed lag, launch → registration first recorded in GCAT</div></div>`;

  const daysRunning = lag.days_running || 0;
  if (!lag.recent_flips || lag.recent_flips.length === 0) {
    flipsEl.innerHTML = `
      <div class="lag-empty"><span class="lag-dot"></span>
        No registrations have flipped from "no record" to "registered" yet — longitudinal observation began ${oscolaDate(lag.started)}${daysRunning ? ` (day ${daysRunning})` : ''}. As registrations appear in GCAT, the interval from launch to recorded registration will be measured and accumulated here on each daily refresh.
      </div>`;
  } else {
    const rows = lag.recent_flips.slice(0, 12).map(f => `
      <tr><td>${f.name || f.norad || '—'}</td><td>${f.owner || ''}</td>
      <td class="num">${f.launch || '—'}</td><td class="num">${f.registered_on || f.registered || '—'}</td>
      <td class="num hl">${f.lag_days != null ? f.lag_days.toLocaleString('en-GB') : '—'}</td></tr>`).join('');
    flipsEl.innerHTML = `<div class="lag-scroll"><table class="dt"><thead><tr>
      <th>Object</th><th>Owner</th><th>Launched</th><th title="Date the UN registration first appeared in GCAT on a daily refresh">Registration observed</th><th class="num">Lag (days)</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  methodEl.innerHTML = `<strong>Method.</strong> Each daily refresh reads the UN registration field (UNReg) that McDowell's GCAT records for every tracked payload. When a payload that had no UN registration record gains one, the instrument logs the days from launch to the refresh on which the registration first became visible, and updates the running median. The lag is therefore an upper bound, precise to the refresh cadence and to GCAT's own update lag. Figures update automatically: this panel measures what it has observed since it began, not a retrospective estimate.`;
}

// ============================================================
// 11e. Provenance additions (Phase 2 · Task E)
// ============================================================
function buildProvenance() {
  const ledEl = $('#provLedger'), casesEl = $('#provCases');
  if (ledEl) {
    const lag = state.lag;
    ledEl.innerHTML = lag
      ? `<div class="pc-h">Registration Lag Index</div>Longitudinal ledger begun ${oscolaDate(lag.started)}; ${lag.days_running||0} day(s) of observation, ${(lag.flips_observed||0).toLocaleString('en-GB')} registration events recorded so far. Each daily refresh compares the catalogue against the UN registration references recorded in McDowell’s GCAT and appends any launch → first-recorded-registration interval it observes. This is a forward-looking measurement, not a retrospective estimate.`
      : `<div class="pc-h">Registration Lag Index</div>Dataset unavailable.`;
  }
  if (casesEl) {
    // OSCOLA 5: websites and news §3.7.1, conference papers §3.7.5, journals §3.3,
    // treaties §4.1, UN documents §4.2.2. Landing pages rather than PDFs where they exist.
    const acc = ' accessed 24 September 2026';
    const cases = [
      { t: 'Aeolus / Starlink-44 (2019)', links: [
        ['‘ESA Spacecraft Dodges Large Constellation’ (<i>European Space Agency</i>, 3 September 2019) <https://www.esa.int/Safety_Security/Space_Debris/ESA_spacecraft_dodges_large_constellation>' + acc, 'https://www.esa.int/Safety_Security/Space_Debris/ESA_spacecraft_dodges_large_constellation'],
        ['Jeff Foust, ‘ESA Spacecraft Dodges Potential Collision with Starlink Satellite’ (<i>SpaceNews</i>, 2 September 2019)' + acc, 'https://spacenews.com/esa-spacecraft-dodges-potential-collision-with-starlink-satellite/'],
        ['Mike Wall, ‘European Satellite Dodges Potential Collision with SpaceX Starlink Craft’ (<i>Space.com</i>, 3 September 2019)' + acc, 'https://www.space.com/spacex-starlink-esa-satellite-collision-avoidance.html']] },
      { t: 'Iridium 33 / Cosmos 2251 (2009)', links: [
        ['TS Kelso, ‘Analysis of the Iridium 33–Cosmos 2251 Collision’ (AAS/AIAA Astrodynamics Specialist Conference, Pittsburgh, August 2009) AAS 09-368', 'https://celestrak.org/publications/AAS/09-368/AAS-09-368.pdf'],
        ['Phillip D Anz-Meador and J-C Liou, ‘Analysis and Consequences of the Iridium 33–Cosmos 2251 Collision’ (38th COSPAR Scientific Assembly, Bremen, July 2010)', 'https://ntrs.nasa.gov/citations/20100008433'],
        ['‘Satellite Collision Leaves Significant Debris Clouds’ (2009) 13(2) <i>Orbital Debris Quarterly News</i> 1', 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv13i2.pdf'],
        ['Ryan Shepperd, ‘Subsequent Assessment of the Collision between Iridium 33 and COSMOS 2251’ (Advanced Maui Optical and Space Surveillance Technologies Conference, Maui, September 2023)', 'https://amostech.com/TechnicalPapers/2023/Conjunction-RPO/Shepperd.pdf'],
        ['Convention on International Liability for Damage Caused by Space Objects (opened for signature 29 March 1972, entered into force 1 September 1972) 961 UNTS 187', 'https://www.unoosa.org/oosa/en/ourwork/spacelaw/treaties/liability-convention.html']] },
      { t: 'Fengyun-1C ASAT test (2007)', links: [
        ['Nicholas L Johnson and others, ‘The Characteristics and Consequences of the Break-up of the Fengyun-1C Spacecraft’ (58th International Astronautical Congress, Hyderabad, September 2007) IAC-07-A6.3.01', 'https://ntrs.nasa.gov/citations/20070007324'],
        ['‘Chinese Anti-satellite Test Creates Most Severe Orbital Debris Cloud in History’ (2007) 11(2) <i>Orbital Debris Quarterly News</i> 2', 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv11i2.pdf'],
        ['(2010) 14(4) <i>Orbital Debris Quarterly News</i> 3 [Fengyun-1C catalogue tally, mid-September 2010]', 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv14i4.pdf'],
        ['‘Mapping Space Debris’ (<i>Center for Security and Emerging Technology</i>, 3 November 2025)' + acc, 'https://cset.georgetown.edu/publication/mapping-space-debris/']] },
      { t: 'Cosmos 1408 ASAT test (2021)', links: [
        ['‘The Intentional Destruction of Cosmos 1408’ (2022) 26(1) <i>Orbital Debris Quarterly News</i> 1', 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv26i1.pdf'],
        ['Antony J Blinken, ‘Russia Conducts Destructive Anti-Satellite Missile Test’ (<i>US Department of State</i>, 15 November 2021)' + acc, 'https://2021-2025.state.gov/russia-conducts-destructive-anti-satellite-missile-test/'],
        ['UNGA Res 77/41 (7 December 2022) UN Doc A/RES/77/41', 'https://undocs.org/A/RES/77/41'],
        ['UNGA Verbatim Record (7 December 2022) UN Doc A/77/PV.46', 'https://undocs.org/A/77/PV.46']] },
      { t: 'Luch / Olymp GEO proximity operations (2014–26)', links: [
        ['Mike Gruss, ‘Russian Satellite Maneuvers, Silence Worry Intelsat’ (<i>SpaceNews</i>, 9 October 2015)' + acc, 'https://spacenews.com/russian-satellite-maneuvers-silence-worry-intelsat/'],
        ['John Leicester, Sylvie Corbet and Aaron Mehta, ‘“Espionage”: French Defense Head Charges Russia of Dangerous Games in Space’ (<i>Defense News</i>, 7 September 2018)' + acc, 'https://www.defensenews.com/space/2018/09/07/espionage-french-defense-head-charges-russia-of-dangerous-games-in-space/'],
        ['Anatoly Zak, ‘Olymp-K’ (<i>RussianSpaceWeb</i>)' + acc, 'http://www.russianspaceweb.com/olymp.html'],
        ['Andrew Jones, ‘Russian “Inspector” Satellite Appears to Break Apart in Orbit, Raising Debris Concerns’ (<i>Space.com</i>, 30 January 2026)' + acc, 'https://www.space.com/space-exploration/launches-spacecraft/russian-inspector-satellite-appears-to-break-apart-in-orbit-raising-debris-concerns']] },
      { t: 'Article IX: text and practice', links: [
        ['Treaty on Principles Governing the Activities of States in the Exploration and Use of Outer Space, including the Moon and Other Celestial Bodies (opened for signature 27 January 1967, entered into force 10 October 1967) 610 UNTS 205, art IX', 'https://www.unoosa.org/oosa/en/ourwork/spacelaw/treaties/outerspacetreaty.html'],
        ['Kai-Uwe Schrogl, ‘“Due Regard” in Outer Space – a Lost Cause?’ (<i>Geneva Centre for Security Policy</i>, In Focus, 13 February 2026)' + acc, 'https://www.gcsp.ch/sites/default/files/2026-02/In%20Focus_26_Schrogl.pdf']] },
      { t: 'Starlink autonomous collision avoidance', links: [
        ['Tereza Pultarova, ‘SpaceX Starlink Satellites Made 50,000 Collision-Avoidance Maneuvers in the Past 6 Months’ (<i>Space.com</i>, 23 July 2024)' + acc, 'https://www.space.com/spacex-starlink-50000-collision-avoidance-maneuvers-space-safety'],
        ['‘SpaceX Destroyed 260 Starlink Satellites in the Atmosphere within Six Months, According to Its Semi-annual Report Filed with the FCC’ (<i>Gigazine</i>, 6 July 2026) [reporting 65,137 and 142,015 manoeuvres by first- and second-generation satellites]' + acc, 'https://gigazine.net/gsc_news/en/20260706-spacex-starlink-satelite']] }
    ];
    casesEl.innerHTML = cases.map(c =>
      `<div class="pc"><div class="pc-h">${c.t}</div><ol class="pc-cites">${c.links.map(([n,u]) => `<li><a href="${u}" target="_blank" rel="noopener">${n.replace(/ <https?:[^>]+>/, '')}</a></li>`).join('')}</ol></div>`).join('');
  }
}



// ============================================================
// 12. UI wiring
// ============================================================
function wireUI() {
  // color modes
  $$('#colorModes .chip').forEach(btn => btn.addEventListener('click', () => {
    $$('#colorModes .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.colorMode = btn.dataset.mode;
    if (!state._scenIsolate) updateColors();
    renderLegend();
  }));
  // filters
  $('#fState').addEventListener('change', e => { state.filters.state = e.target.value; refreshFilters(); });
  $('#fType').addEventListener('change', e => { state.filters.type = e.target.value; refreshFilters(); });
  $('#fConst').addEventListener('change', e => { state.filters.const = e.target.value; refreshFilters(); });
  $('#fReg').addEventListener('change', e => { state.filters.reg = e.target.value; refreshFilters(); });
  $$('#fRegime .chip').forEach(btn => btn.addEventListener('click', () => {
    $$('#fRegime .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filters.regime = btn.dataset.r; refreshFilters();
  }));

  // time — play state changes ONLY via setPlaying/setSpeed so the icon can
  // never invert, and changing the multiplier never starts playback.
  $('#tPlay').addEventListener('click', () => {
    if (histMode) { // during a replay, play/pause controls the replay itself
      histMode.paused = !histMode.paused;
      $('#playPath').setAttribute('d', !histMode.paused ? ICON_PAUSE : ICON_PLAY);
      return;
    }
    setPlaying(!state.playing);
  });
  $('#tNow').addEventListener('click', () => { if (histMode) histExit(); state.simTime = Date.now(); });
  $$('.timebar [data-speed]').forEach(btn => btn.addEventListener('click', () => {
    if (histMode) return; // replay owns the clock
    setSpeed(parseInt(btn.dataset.speed, 10)); // multiplier only — never touches play state
  }));
  setPlaying(state.playing); // sync icon/aria with the actual boot state

  // historical replay
  const hbBtn = $('#scenHist');
  if (hbBtn) hbBtn.addEventListener('click', async () => {
    const id = curScen().id;
    if (!HIST_IDS.has(id)) return;
    hbBtn.disabled = true;
    try {
      await Promise.all([loadSatLib(), loadHistData()]);
      if (histData.events[id]) histStart(id);
    } catch (e) {
      console.error('replay load failed', e);
    } finally { hbBtn.disabled = false; }
  });
  $('#hhExit').addEventListener('click', histExit);
  $('#hhAgain').addEventListener('click', () => { if (histMode) histStart(histMode.id); });

  // support / donation UI (hidden until SUPPORT_URL is configured)
  if (SUPPORT_URL) {
    $('#footSupport').style.display = '';
    $('#footSupportLink').href = SUPPORT_URL;
    $('#supportBox').style.display = '';
    $('#supportBtn').href = SUPPORT_URL;
    const ts = $('#topSupport'); if (ts) { ts.href = SUPPORT_URL; ts.style.display = ''; }
  }

  // detail close
  $('#dClose').addEventListener('click', (e) => { lastClose = { t: Math.round(performance.now()), trusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY) }; $('#detail').classList.remove('show'); selectedIndex = -1; if(!state._scenIsolate) updateColors(); selMarker.visible=false; clearSelOrbit(); syncURL(); });

  // catalogue search (name / NORAD / international designator)
  wireSearch();
  wireUITail();
}

// ---- Citations -----------------------------------------------------------
// Every value is read at runtime from site/data/citation.json (generated at
// deploy time from CITATION.cff + Zenodo) and from the dataset the browser
// ACTUALLY loaded. A literal version, DOI or date in this file is a bug.
// OSCOLA (5th edn) s 3.7: with a DOI there is no URL and no access date.
function oscolaDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function citeForms() {
  const c = state.citation;
  if (!c || !c.version || !c.version_doi) return null;
  // Snapshot date = the dataset actually loaded in this session (falls back to
  // the manifest's snapshot only if the dataset carried no date).
  const loaded = ((state.data && state.data.generated) || '').substring(0, 10);
  const snapISO = loaded || c.snapshot_date;
  const D = oscolaDate(snapISO), V = c.version, Y = c.publisher_year, DOI = c.version_doi;
  // OSCOLA 5 §3.7.1 / §3.1.3: a pinpoint comes at the end of the citation and
  // before the DOI, after the closing bracket with no comma.
  const footPin = (pin) => `Hallam Burnapp, 'STARS Observatory' (version ${V}, data snapshot ${D}, University of Aberdeen ${Y})${pin ? ' ' + pin : ''} DOI: ${DOI}.`;
  return {
    foot: footPin(''),
    footPin,
    bib: `Burnapp H, 'STARS Observatory' (version ${V}, data snapshot ${D}, University of Aberdeen ${Y}) DOI: ${DOI}`,
    bibtex: `@software{burnapp_stars_${Y},
  author        = {Burnapp, Hallam},
  title         = {STARS Observatory},
  version       = {${V}},
  date          = {${c.date_released}},
  year          = {${Y}},
  organization  = {University of Aberdeen},
  license       = {MIT},
  note          = {Data: CelesTrak GP/SATCAT and McDowell GCAT; data snapshot of ${snapISO}},
  url           = {https://starsobservatory.org},
  doi           = {${DOI}}
}`,
    snapLoaded: loaded, snapManifest: c.snapshot_date
  };
}

let citeForm = 'foot'; // remembered per tab-session; a fresh visit starts on footnote
function renderCiteForm() {
  const f = citeForms(); if (!f) return;
  const os = $('#citeOscola'); if (os) os.textContent = citeForm === 'bib' ? f.bib : f.foot;
  const bf = $('#csFoot'), bb = $('#csBib');
  if (bf) { bf.classList.toggle('active', citeForm === 'foot'); bf.setAttribute('aria-pressed', String(citeForm === 'foot')); }
  if (bb) { bb.classList.toggle('active', citeForm === 'bib'); bb.setAttribute('aria-pressed', String(citeForm === 'bib')); }
}
function citeConfirm(msg) {
  const cc = $('#citeConfirm'); if (!cc) return;
  cc.textContent = msg; cc.classList.add('show');
  clearTimeout(cc._t); cc._t = setTimeout(() => cc.classList.remove('show'), 2400);
}
function setCiteForm(form) {
  citeForm = form === 'bib' ? 'bib' : 'foot';
  try { sessionStorage.setItem('citeForm', citeForm); } catch (e) { /* private browsing */ }
  renderCiteForm();
  const os = $('#citeOscola');
  const label = citeForm === 'bib' ? 'bibliography' : 'footnote';
  if (os) copyText(os.textContent).then(ok => {
    citeConfirm(ok ? `Copied — ${label} form` : `Showing ${label} form — copy failed, select the text above`);
  });
}

function fillCitations() {
  const os = $('#citeOscola'), bib = $('#citeBibtex'), db = $('#doiBlock'), g = $('#citeGuide');
  const c = state.citation, f = citeForms();
  if (!f) {
    // Honest failure — never render a guessed or stale citation.
    const msg = 'Citation unavailable — the citation manifest (data/citation.json) did not load. Citation data is maintained in CITATION.cff in the source repository.';
    if (os) os.textContent = msg;
    if (bib) bib.textContent = msg;
    if (db) db.innerHTML = '<a href="https://github.com/hallamburnapp-cloud/stars-observatory" target="_blank" rel="noopener">source &amp; data pipeline</a>';
    return;
  }
  try { citeForm = sessionStorage.getItem('citeForm') === 'bib' ? 'bib' : 'foot'; } catch (e) { citeForm = 'foot'; }
  renderCiteForm();
  if (bib) bib.textContent = f.bibtex;
  if (g) g.textContent = 'Footnote form for footnotes; bibliography form (surname first, no trailing full stop) for the bibliography. Selecting a form also copies it. How it works in practice: the version pins the archived software release — its DOI resolves permanently to that release on Zenodo — while the data snapshot date pins the day\u2019s dataset behind every figure you cite. Each day\u2019s dataset is preserved in the repository\u2019s data archive, so a cited snapshot remains retrievable after the live site refreshes.';
  if (db) db.innerHTML =
    `Version DOI <a href="https://doi.org/${c.version_doi}" target="_blank" rel="noopener">${c.version_doi}</a>` +
    `${c.version_doi_version ? ` (archives ${c.version_doi_version})` : ''} — cites the exact archived release · ` +
    `Concept DOI <a href="https://doi.org/${c.concept_doi}" target="_blank" rel="noopener">${c.concept_doi}</a> — always resolves to the latest archived version · ` +
    `<a href="https://github.com/hallamburnapp-cloud/stars-observatory" target="_blank" rel="noopener">source &amp; data pipeline</a> · ` +
    `<a href="https://github.com/hallamburnapp-cloud/stars-observatory-data/releases/tag/data-archive" target="_blank" rel="noopener">daily data archive</a> — every cited snapshot stays retrievable`;
  const fdv = $('#footDoiVal'); if (fdv) fdv.textContent = c.version_doi;
  const fda = $('#footDoi'); if (fda) fda.href = 'https://doi.org/' + c.version_doi;
  // If the dataset the browser loaded disagrees with the deployed manifest
  // (e.g. a stale cache), say so — the citation always follows the loaded data.
  const w = $('#citeWarn');
  if (w && f.snapLoaded && f.snapManifest && f.snapLoaded !== f.snapManifest) {
    w.style.display = '';
    w.textContent = `Note: the dataset loaded in this session is dated ${oscolaDate(f.snapLoaded)}, but the current deployment expects ${oscolaDate(f.snapManifest)} — your browser may have cached an older dataset. The citation above cites the data you are actually viewing; reload to fetch the current snapshot.`;
  }
}

function wireUITail() {

  // panels / drawer
  $$('.tabbar button').forEach(btn => btn.addEventListener('click', () => openPanel(btn.dataset.panel)));
  $$('#drawerNav button').forEach(btn => btn.addEventListener('click', () => openPanel(btn.dataset.panel)));
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#footProv').addEventListener('click', () => openPanel('prov'));
  $('#footCite').addEventListener('click', () => {
    openPanel('prov');
    setTimeout(() => {
      const el = $('#citeSec'); const body = el && el.closest('.drawer-body');
      if (el && body) body.scrollTo({ top: el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 10, behavior: 'smooth' });
    }, 350);
  });
  fillCitations();
  // Citation form switch — selecting a form renders AND copies it.
  const csF = $('#csFoot'), csB = $('#csBib');
  if (csF) csF.addEventListener('click', () => setCiteForm('foot'));
  if (csB) csB.addEventListener('click', () => setCiteForm('bib'));
  $$('.copybtn').forEach(b => b.addEventListener('click', () => {
    const src = $('#' + b.dataset.copy);
    if (!src) return;
    copyText(src.textContent).then(ok => {
      const t = 'Copy'; b.textContent = ok ? 'Copied ✓' : 'Copy failed';
      if (ok && b.dataset.copy === 'citeOscola') citeConfirm(`Copied — ${citeForm === 'bib' ? 'bibliography' : 'footnote'} form`);
      setTimeout(() => { b.textContent = t; }, 1400);
    });
  }));

  // scenario
  $('#scenPlay').addEventListener('click', scenPlay);
  $('#scenViz').addEventListener('click', toggleScenViz);

  // mobile rail toggle
  $('#railToggle').addEventListener('click', () => {
    const open = $('#rail').classList.toggle('open');
    $('#railToggle').classList.toggle('active', open);
  });
}

function refreshFilters() {
  if (state._scenIsolate) return;
  updateColors();
}

// ============================================================
// Catalogue search
// ============================================================
function searchCatalogue(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  const isNum = /^\d+$/.test(q);
  for (let i = 0; i < state.N; i++) {
    let score = -1;
    const nm = state.name[i].toLowerCase();
    if (isNum) {
      const nid = String(state.norad[i]);
      if (nid === q) score = 0;
      else if (nid.startsWith(q)) score = 1;
    } else {
      if (nm.startsWith(q)) score = 0;
      else if (nm.includes(q)) score = 2;
      else if (state.intl[i] && state.intl[i].toLowerCase().includes(q)) score = 1;
    }
    if (score >= 0) out.push([score, i]);
    if (out.length > 400) break;
  }
  out.sort((a, b) => a[0] - b[0] || state.name[a[1]].length - state.name[b[1]].length);
  return out.slice(0, 10).map(x => x[1]);
}

function wireSearch() {
  const inp = $('#satSearch'), box = $('#searchResults');
  if (!inp || !box) return;
  const wrap = inp.closest('.search');
  const mq = window.matchMedia('(max-width: 820px)');
  const close = () => {
    box.classList.remove('open'); box.innerHTML = '';
    if (wrap) { wrap.classList.remove('mopen'); }
  };
  // On small screens the search collapses to an icon — tapping it expands a
  // full-width overlay with a finger-sized input.
  if (wrap) wrap.addEventListener('click', () => {
    if (mq.matches && !wrap.classList.contains('mopen')) {
      wrap.classList.add('mopen');
      inp.focus();
    }
  });
  const run = () => {
    const hits = searchCatalogue(inp.value);
    if (!hits.length) { close(); return; }
    box.innerHTML = hits.map(i => `
      <button class="sr" data-i="${i}">
        <span class="sr-name">${state.name[i]}</span>
        <span class="sr-meta">${state.norad[i]} · ${fullType(state.objType[i])} · ${state.ownerCode[i]}</span>
      </button>`).join('');
    box.classList.add('open');
    box.querySelectorAll('.sr').forEach(b => b.addEventListener('click', () => {
      const i = parseInt(b.dataset.i, 10);
      selectObject(i, true);
      close(); inp.blur();
    }));
  };
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const f = box.querySelector('.sr'); if (f) f.click(); }
    if (e.key === 'Escape') { close(); inp.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });
  document.addEventListener('keydown', (e) => {
    // Escape closes the topmost overlay: chooser, then object card, then panel.
    if (e.key === 'Escape' && document.activeElement !== inp) {
      if (pickEl) { hidePickChooser(); return; }
      if ($('#detail').classList.contains('show')) { $('#dClose').click(); return; }
      if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    }
    if (e.key === '/' && document.activeElement !== inp &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); inp.focus();
    }
  });
}

// Deep link: ?sat=<NORAD> selects and flies to an object once positions exist.
function applyPermalink() {
  const q = INITIAL_QUERY.get('sat');
  if (!q) return;
  for (let i = 0; i < state.N; i++) {
    if (String(state.norad[i]) === q) {
      const wait = setInterval(() => {
        if (state.lastAlive && state.lastAlive[i]) {
          clearInterval(wait);
          selectObject(i, true);
        }
      }, 150);
      setTimeout(() => clearInterval(wait), 15000);
      return;
    }
  }
}

const PANEL_META = {
  art6: { tag: 'Analytical panel · 01', title: 'Article VI — Supervision burden' },
  reggap: { tag: 'Analytical panel · 02', title: 'Registration lag' },
  art9: { tag: 'Analytical panel · 03', title: 'Article IX — Incident replays' },
  prov: { tag: 'Analytical panel · 04', title: 'Provenance & limitations' }
};
function openPanel(name) {
  $$('.panel').forEach(p => p.classList.remove('active'));
  $('#panel-' + name).classList.add('active');
  $('#drawerTag').textContent = PANEL_META[name].tag;
  $('#drawerTitle').textContent = PANEL_META[name].title;
  $$('#drawerNav button').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  $('#drawer').querySelector('.drawer-body').scrollTop = 0;
  $('#drawer').classList.add('open');
  dismissFirstHint();
  syncURL();
  // Defensive: some browsers scroll fixed-layout ancestors on focus/scrollIntoView,
  // which has no scrollbar to recover from. Pin them back to the origin.
  const mn = document.querySelector('main'); if (mn) { mn.scrollTop = 0; mn.scrollLeft = 0; }
  const app = document.getElementById('app'); if (app) { app.scrollTop = 0; app.scrollLeft = 0; }
  if (document.scrollingElement) { document.scrollingElement.scrollTop = 0; document.scrollingElement.scrollLeft = 0; }
}
function closeDrawer() { $('#drawer').classList.remove('open'); syncURL(); }


// ============================================================
// 13. Shareable views, CSV export
// ============================================================
// The address bar always describes the current view (colour mode, filters,
// selected object), so any view can be shared or cited as-is.
const FILTER_KEYS = ['state', 'type', 'const', 'reg', 'regime'];
// The query as the page was opened: read by applyViewFromURL/applyPermalink,
// which run after syncURL may already have rewritten location.search.
const INITIAL_QUERY = new URLSearchParams(location.search);
let viewReady = false; // no URL writes until the URL's own view has been applied
function viewQuery() {
  const q = new URLSearchParams();
  if (state.colorMode !== 'type') q.set('color', state.colorMode);
  for (const k of FILTER_KEYS) if (state.filters[k] !== '') q.set(k, state.filters[k]);
  if (selectedIndex >= 0) q.set('sat', String(state.norad[selectedIndex]));
  return q;
}
function viewURL() {
  const q = viewQuery().toString();
  return location.origin + location.pathname + (q ? '?' + q : '');
}
function syncURL() {
  if (!viewReady) return;
  try {
    const q = viewQuery().toString();
    const next = location.pathname + (q ? '?' + q : '') + location.hash;
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
  } catch (e) { /* sandboxed iframes may forbid history writes */ }
}
function setColorMode(mode) {
  const btn = document.querySelector(`#colorModes .chip[data-mode="${mode}"]`);
  if (!btn) return false;
  $$('#colorModes .chip').forEach(b => b.classList.toggle('active', b === btn));
  state.colorMode = mode;
  if (!state._scenIsolate) updateColors();
  renderLegend();
  return true;
}
// Apply ?color= &state= &type= &const= &reg= &regime= (and ?sat=
// via applyPermalink). Unknown values are ignored rather than half-applied.
function applyViewFromURL() {
  const q = INITIAL_QUERY;
  const c = q.get('color'); if (c) setColorMode(c);
  const sel = { state: '#fState', type: '#fType', const: '#fConst', reg: '#fReg' };
  for (const [k, id] of Object.entries(sel)) {
    const v = q.get(k); if (v === null) continue;
    const el = $(id);
    if ([...el.options].some(o => o.value === v)) { el.value = v; state.filters[k] = v; }
  }
  const r = q.get('regime');
  if (r !== null) {
    const chip = document.querySelector(`#fRegime .chip[data-r="${r}"]`);
    if (chip) { $$('#fRegime .chip').forEach(b => b.classList.toggle('active', b === chip)); state.filters.regime = r; }
  }
  refreshFilters();
  viewReady = true;
  syncURL();
}

// ---- CSV export of the objects the current filters select -----------------
const REGIME_NAMES = ['LEO', 'MEO', 'GEO', 'HEO'];
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function filteredIndices() {
  const out = [];
  for (let i = 0; i < state.N; i++) if (passesFilter(i)) out.push(i);
  return out;
}
function exportCSV(indices, label) {
  const snap = ((state.data && state.data.generated) || '').substring(0, 10);
  const head = ['norad_cat_id', 'name', 'intl_designator', 'object_type', 'responsible_state_code', 'responsible_state',
    'constellation', 'un_registration', 'launch_year', 'orbital_regime', 'tle_line1', 'tle_line2', 'data_snapshot'];
  const rows = [head.join(',')];
  for (const i of indices) {
    const rec = state.data.sats[i];
    rows.push([state.norad[i], state.name[i], state.intl[i], state.objType[i], state.ownerCode[i], state.ownerName[i],
      state.constLabel[i], state.objType[i] === 'PAY' ? (state.registered[i] ? 'registered' : 'no UN record') : 'not assessed',
      state.launchYear[i], state.regime ? REGIME_NAMES[state.regime[i]] : '', rec[2], rec[3], snap].map(csvCell).join(','));
  }
  const blob = new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stars-observatory_${snap}_${label || 'all'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return rows.length - 1;
}
function viewLabel() {
  const parts = [];
  for (const k of FILTER_KEYS) if (state.filters[k] !== '') parts.push(k + '-' + (k === 'regime' ? REGIME_NAMES[+state.filters[k]] : state.filters[k]));
  return (parts.join('_') || 'all').replace(/[^A-Za-z0-9_-]+/g, '');
}
function flashButton(btn, msg, back) {
  btn.textContent = msg;
  clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = back; }, 1800);
}

function escapeHTML(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
// ---- First-visit hint --------------------------------------------------------
// Shown once per browser until the visitor dismisses it or opens any object.
const HINT_KEY = 'stars.hintSeen';
function showFirstHint() {
  let seen = false;
  try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { /* storage blocked */ }
  if (seen || INITIAL_QUERY.has('sat')) return;
  const el = $('#firstHint'); if (!el) return;
  if (IS_TOUCH) $('#firstHintText').innerHTML = 'Tap any dot to open its catalogue and legal-attribution record · drag to rotate · pinch to zoom';
  el.hidden = false;
  $('#firstHintClose').addEventListener('click', dismissFirstHint);
}
function dismissFirstHint() {
  const el = $('#firstHint'); if (!el || el.hidden) return;
  el.hidden = true;
  try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* storage blocked */ }
}
function wireViewTools() {
  $('#vCopy').addEventListener('click', e => copyText(viewURL()).then(ok => flashButton(e.target, ok ? 'Link copied ✓' : viewURL(), 'Copy link to this view')));
  $('#vCsv').addEventListener('click', e => {
    const n = exportCSV(filteredIndices(), viewLabel());
    flashButton(e.target, `Downloaded ${n.toLocaleString('en-GB')} rows ✓`, 'Download these objects (CSV)');
  });
  ['#fState', '#fType', '#fConst', '#fReg'].forEach(id => $(id).addEventListener('change', syncURL));
  $$('#fRegime .chip, #colorModes .chip').forEach(b => b.addEventListener('click', syncURL));
}

// ============================================================
// Boot
// ============================================================
async function boot() {
  try {
    spawnWorker();
    const { tle1, tle2 } = await loadData();
    initThree();
    buildPointCloud();
    populateFilters();
    renderLegend();
    buildArt6();
    buildRegGap();
    buildLagIndex();
    buildThreeClocks();
    buildScenarioCards();
    selectScenario(0);
    buildProvenance();
    wireUI();
    wireViewTools();
    await startWorker(tle1, tle2);
    // first propagation
    requestPropagation(state.simTime);
    // wait for first positions then hide loader
    const waitReady = setInterval(() => {
      if (state.ready) {
        clearInterval(waitReady);
        setLoad('Live', 100);
        applyPositions();
        applyViewFromURL();
        applyPermalink();
        showFirstHint();
        setTimeout(() => { const l = $('#loader'); if (l) l.style.display = 'none'; }, 350);
        upgradeEarthTexture();
      }
    }, 80);
    animate();
  } catch (err) {
    console.error(err);
    const st = $('#loadStatus'); if (st) { st.textContent = 'Error: ' + err.message; st.style.color = '#ff6b6b'; }
  }
}

// After first render, give large desktop screens the 4K day texture.
function upgradeEarthTexture() {
  const px = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  if (IS_TOUCH || px < 1600 || renderer.capabilities.maxTextureSize < 4096) return;
  const conn = navigator.connection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;
  new THREE.TextureLoader().load('./assets/earth_day_4k.webp', (t4) => {
    t4.colorSpace = THREE.SRGBColorSpace;
    t4.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const old = earthMaterial.uniforms.dayTex.value;
    earthMaterial.uniforms.dayTex.value = t4;
    old.dispose();
    render();
  });
}

boot();
window.__OBS = state; // debug handle for QA
// QA-only helpers: expose projection + select so automated tests can verify picking
window.__QA = {
  histJump(p) { if (histMode) { histMode.p = Math.max(0, Math.min(1, p)); } },
  histDebris() {
    if (!histMode || !histMode.debris) return null;
    return histMode.debris.map(C => ({ n: C.n, opacity: C.pts.material.opacity,
      sample: [C.pos[0], C.pos[1], C.pos[2]], inScene: !!C.pts.parent }));
  },
  hist() {
    if (!histMode) return null;
    return { cam: camera.position.toArray(), userCam: histMode.userCam, camDist: histMode.camDist, camDir: histMode.camDir && histMode.camDir.toArray(),
      objs: histMode.objs.map(o => ({ pos: o.pos.toArray(), vis: o.grp.visible, hasParent: !!o.grp.parent, mScale: o.marker.scale.toArray(), lScale: o.label.scale.toArray(), lPos: o.label.position.toArray() })) };
  },
  screenOf(idx) {
    const pa = posAttr.array;
    return toClient(pa[idx*3], pa[idx*3+1], pa[idx*3+2], viewRect());
  },
  select(idx) { selectObject(idx); },
  // Rendered dots that are on the canvas, not hidden behind the Earth, and
  // have no other dot within minPx on screen — the only dots whose drawn
  // position a screenshot diff can isolate unambiguously.
  isolatedOnScreen(minPx) {
    const r = viewRect(), pa = posAttr.array, pts = [];
    for (const i of this.eligible()) {
      if (earthOccluded(pa[i*3], pa[i*3+1], pa[i*3+2])) continue;
      const q = toClient(pa[i*3], pa[i*3+1], pa[i*3+2], r);
      if (q.z > 1 || q.x < r.left + 16 || q.x > r.right - 16 || q.y < r.top + 16 || q.y > r.bottom - 16) continue;
      pts.push([i, q.x, q.y]);
    }
    const cell = Math.max(4, minPx), grid = new Map(), key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    for (const p of pts) { const k = key(p[1], p[2]); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
    const out = [];
    for (const [i, x, y] of pts) {
      let alone = true;
      for (let dx = -1; dx <= 1 && alone; dx++) for (let dy = -1; dy <= 1 && alone; dy++) {
        for (const [j, x2, y2] of grid.get(`${Math.floor(x / cell) + dx}:${Math.floor(y / cell) + dy}`) || [])
          if (j !== i && Math.hypot(x2 - x, y2 - y) < minPx) { alone = false; break; }
      }
      if (alone) out.push(i);
    }
    return out;
  },
  occluded(idx) { const pa = posAttr.array; return earthOccluded(pa[idx*3], pa[idx*3+1], pa[idx*3+2]); },
  // Recolour ONE dot (or restore it) without any other visual change, so a
  // screenshot diff yields the exact pixel where the dot is really drawn —
  // ground truth that is independent of the app's own projection maths.
  flash(idx, on) {
    if (!on) { updateColors(); render(); return; }
    const ca = colorAttr.array;
    ca[idx*3] = 1; ca[idx*3+1] = 0; ca[idx*3+2] = 1;
    colorAttr.needsUpdate = true; render();
  },
  get selected() { return selectedIndex; },
  setCam(x, y, z) { camera.position.set(x, y, z); controls.update(); },
  // Drain OrbitControls' damping so the camera is exactly still (a tap can
  // leave a little inertia that keeps easing the view for a second).
  settle() { for (let k = 0; k < 400; k++) controls.update(); camera.updateMatrixWorld(true); render(); },
  get sunDir() { return sunDirWorld ? sunDirWorld.toArray() : null; },
  rayTest(nx, ny) {
    pointer.x = nx; pointer.y = ny;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(points);
    return { count: hits.length, first: hits[0] ? { index: hits[0].index, dist: hits[0].distanceToRay } : null };
  },
  // Full pick simulation for automated QA: aims the camera down the object's
  // radial (so it cannot be Earth-occluded), projects it, and runs the REAL
  // production pick path — including the dense-cluster chooser — then reports
  // whether the object ended up selected with a matching detail card.
  pickTest(idx, distFactor, tiltDeg, pxOff) {
    if (!state.lastAlive || !state.lastAlive[idx]) return { ok: false, why: 'not-alive' };
    if (!passesFilter(idx)) return { ok: false, why: 'filtered' };
    const pa = posAttr.array;
    const p = new THREE.Vector3(pa[idx*3], pa[idx*3+1], pa[idx*3+2]);
    if (p.lengthSq() < 0.01) return { ok: false, why: 'no-position' };
    // Camera sits above the object along its radial (never Earth-occluded),
    // at a separation derived from distFactor but clamped so that even GEO
    // objects can be approached closely — mirroring what a user does by
    // zooming in. A tilt angle swings the camera around the object, changing
    // the line of sight for retries when a neighbour sits exactly in front.
    const len = p.length();
    const sep = Math.min(Math.max(len * Math.abs((distFactor || 1.35) - 1), 1.5), 30);
    const u = p.clone().normalize();
    let offset = u.clone().multiplyScalar(sep);
    if (tiltDeg) {
      const ref = Math.abs(u.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const axis = ref.cross(u).normalize();
      offset = offset.applyAxisAngle(axis, tiltDeg * Math.PI / 180);
    }
    camera.position.copy(p).add(offset);
    camera.lookAt(p.x, p.y, p.z);
    camera.updateMatrixWorld(true);
    const s = this.screenOf(idx);
    const vr = viewRect();
    if (!(s.x >= vr.left + 2 && s.x <= vr.right - 2 && s.y >= vr.top + 2 && s.y <= vr.bottom - 2) || s.z > 1) {
      return { ok: false, why: 'offscreen', s };
    }
    // A pointer offset forces the chooser path: clicking dead-on an object
    // that has a nearly co-located twin always direct-selects the nearer of
    // the two, so the only way a user reaches the other one is a click a few
    // pixels off — which opens the disambiguation chooser.
    const cx = s.x + (pxOff || 0), cy = s.y + (pxOff || 0) * 0.4;
    setPointerFromClient(cx, cy);
    hidePickChooser();
    selectedIndex = -1;
    pickAt(cx, cy);
    let mode = 'direct';
    if (pickEl) { // dense cluster — the chooser must list the object
      mode = 'chooser';
      const b = pickEl.querySelector(`.sr[data-i="${idx}"]`);
      if (!b) {
        const listed = pickEl.querySelectorAll('.sr').length;
        hidePickChooser();
        return { ok: false, why: 'chooser-missing', listed };
      }
      b.click();
    }
    if (selectedIndex !== idx) return { ok: false, why: 'wrong-selection', mode, got: selectedIndex };
    const cardNorad = ($('#dRows') && $('#dRows').textContent.includes(String(state.norad[idx])));
    const cardName = ($('#dName') && $('#dName').textContent.trim().length > 0);
    const shown = $('#detail') && $('#detail').classList.contains('show');
    return { ok: !!(cardNorad && cardName && shown), mode,
             why: (cardNorad && cardName && shown) ? undefined : 'card-mismatch' };
  },
  // Indices that are rendered right now (alive, unfiltered, positioned) — the
  // exact population the pick test must cover.
  eligible() {
    const out = []; const pa = posAttr.array;
    for (let i = 0; i < state.N; i++) {
      if (!state.lastAlive || !state.lastAlive[i]) continue;
      if (!passesFilter(i)) continue;
      if (pa[i*3]*pa[i*3] + pa[i*3+1]*pa[i*3+1] + pa[i*3+2]*pa[i*3+2] < 0.01) continue;
      out.push(i);
    }
    return out;
  },
  norad(i) { return String(state.norad[i]); },
  // Aim the camera at object idx along its radial (never Earth-occluded) and
  // return its CSS-pixel screen position plus a crowding count — for QA tests
  // that drive REAL page.mouse.click events instead of the synthetic pick path.
  aimAt(idx, distFactor) {
    const pa = posAttr.array;
    const p = new THREE.Vector3(pa[idx*3], pa[idx*3+1], pa[idx*3+2]);
    if (p.lengthSq() < 0.01) return null;
    const sep = Math.min(Math.max(p.length() * Math.abs((distFactor || 1.35) - 1), 1.5), 30);
    camera.position.copy(p).add(p.clone().normalize().multiplyScalar(sep));
    camera.lookAt(p.x, p.y, p.z);
    camera.updateMatrixWorld(true);
    const s = this.screenOf(idx);
    let crowd = 0;
    for (let i = 0; i < state.N; i++) {
      if (i === idx || !state.lastAlive || !state.lastAlive[i]) continue;
      if (pa[i*3]*pa[i*3] + pa[i*3+1]*pa[i*3+1] + pa[i*3+2]*pa[i*3+2] < 0.01) continue;
      const q = this.screenOf(i);
      if (q.z <= 1 && Math.hypot(q.x - s.x, q.y - s.y) < 6) crowd++;
    }
    return { x: s.x, y: s.y, z: s.z, crowd };
  },
  // Alive + positioned regardless of filters — the dimmed dots included.
  aliveAll() {
    const out = []; const pa = posAttr.array;
    for (let i = 0; i < state.N; i++) {
      if (!state.lastAlive || !state.lastAlive[i]) continue;
      if (pa[i*3]*pa[i*3] + pa[i*3+1]*pa[i*3+1] + pa[i*3+2]*pa[i*3+2] < 0.01) continue;
      out.push(i);
    }
    return out;
  },
  datasetCounts() {
    const byType = {}, byOwner = {};
    for (let i = 0; i < state.N; i++) {
      byType[state.objType[i]] = (byType[state.objType[i]] || 0) + 1;
      byOwner[state.ownerCode[i]] = (byOwner[state.ownerCode[i]] || 0) + 1;
    }
    return { N: state.N, byType, byOwner };
  },
  vis() { return visibleCount; },
  stateOption(code) { const o = document.querySelector(`#fState option[value="${code}"]`); return o ? o.textContent : null; },
  legendRows() { return [...document.querySelectorAll('#legend .legend-row')].map(r => r.textContent.trim()); },
  filteredOut(i) { return !passesFilter(i); },
  detailNorad() { const d = $('#detail'); return (d && d.classList.contains('show') && $('#dRows')) ? $('#dRows').textContent : ''; },
  chooserOpen() { return !!pickEl; },
  get lastUp() { return lastUp; },
  get lastClose() { return lastClose; },
  chooserPick(idx) { const b = pickEl && pickEl.querySelector(`.sr[data-i="${idx}"]`); if (b) { b.click(); return true; } return false; },
  // Dense-cluster chooser test: find two rendered objects that project within
  // a few pixels of each other, click between them, and assert the chooser
  // appears, lists both, and resolves to the requested object.
  chooserTest(seed) {
    const s0 = seed || 0; // vary the viewpoint between attempts
    camera.position.set(s0 * 25, 70 + s0 * 20, 200 - s0 * 15);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const el = this.eligible();
    const pa = posAttr.array, vr = viewRect();
    const grid = new Map();
    const pairs = [];
    for (const i of el) {
      if (earthOccluded(pa[i*3], pa[i*3+1], pa[i*3+2])) continue;
      const s = this.screenOf(i);
      if (s.z > 1 || s.x < vr.left + 30 || s.x > vr.right - 30 || s.y < vr.top + 30 || s.y > vr.bottom - 30) continue;
      const key = `${Math.round(s.x / 3)}:${Math.round(s.y / 3)}`;
      if (grid.has(key)) {
        const j = grid.get(key); const sj = this.screenOf(j.i);
        if (Math.hypot(s.x - sj.x, s.y - sj.y) < 4) {
          pairs.push([j.i, i, (s.x + sj.x) / 2, (s.y + sj.y) / 2]);
          if (pairs.length >= 60) break;
        }
      }
      grid.set(key, { i });
    }
    if (!pairs.length) return { ok: false, why: 'no-pair-found' };
    // Click ~8px off each pair: near enough that both are candidates, far
    // enough that neither wins the dead-on direct-select rule. Some pairs
    // still resolve directly (a third object dominates) — try the next pair.
    let tried = 0;
    for (const [a, b, mx, my] of pairs) {
      tried++;
      setPointerFromClient(mx + 8, my + 3);
      hidePickChooser();
      selectedIndex = -1;
      pickAt(mx + 8, my + 3);
      if (!pickEl) continue;
      const rows = pickEl.querySelectorAll('.sr').length;
      const btn = pickEl.querySelector(`.sr[data-i="${a}"]`) || pickEl.querySelector(`.sr[data-i="${b}"]`);
      if (!btn) {
        hidePickChooser();
        // A full list means 40+ objects sit even closer to the click than the
        // pair (the chooser then says "zoom in to separate") — try another pair.
        if (rows >= 40) continue;
        return { ok: false, why: 'pair-not-listed', rows, tried };
      }
      const want = parseInt(btn.dataset.i, 10);
      btn.click();
      const card = $('#dRows') && $('#dRows').textContent.includes(String(state.norad[want]));
      return { ok: selectedIndex === want && !!card, rows, tried,
               why: (selectedIndex === want && card) ? undefined : 'chooser-pick-mismatch' };
    }
    return { ok: false, why: 'direct-instead', tried };
  },
  // Mirrors renderLegend's type-mode footnote arithmetic exactly.
  legendRB() {
    const catalogRB = (state.stats.by_type && state.stats.by_type['R/B']) || 0;
    let renderedRB = 0;
    for (let i = 0; i < state.N; i++) if (state.objType[i] === 'R/B') renderedRB++;
    return { catalogRB, renderedRB, noGP: Math.max(0, catalogRB - renderedRB) };
  },
  playing() { return !!state.playing; },
  pause() { setPlaying(false); }
};
