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
const SUPPORT_URL = null;

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
  data: null, stats: null, lag: null, natlaw: null,
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

// ============================================================
// 1. Load data
// ============================================================
async function loadData() {
  setLoad('Loading orbital catalog…', 10);
  const [sats, stats, lag, natlaw] = await Promise.all([
    fetch('./data/sats.json', { cache: 'no-cache' }).then(r => r.json()),
    fetch('./data/stats.json', { cache: 'no-cache' }).then(r => r.json()),
    fetch('./data/lag.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
    fetch('./data/national_law.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null)
  ]);
  state.data = sats; state.stats = stats; state.lag = lag; state.natlaw = natlaw;
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
    tle1[i] = s[2]; tle2[i] = s[3];
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
    state.intl[i] = parseIntlDes(s[2]);
  }
  setLoad('Parsing element sets…', 30);
  fillStats();
  return { tle1, tle2 };
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
let worker;
function startWorker(tle1, tle2) {
  return new Promise((resolve) => {
    worker = new Worker('./js/worker.js?v=1.3.0');
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
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
  if (!worker) return;
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
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05070d, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 20000);
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
  const tex = new THREE.TextureLoader().load('./assets/earth_day.jpg', () => { render(); });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const nightTex = new THREE.TextureLoader().load('./assets/earth_night.jpg', () => { render(); });
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
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
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
    const pulse = 1 + 0.16 * Math.sin(performance.now() * 0.004);
    selMarker.scale.setScalar(selDist * 0.052 * pulse);
    selMarker.material.opacity = 0.75 + 0.25 * Math.sin(performance.now() * 0.004);
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
  if (!histMode && worker && now - lastPropReq > (IS_TOUCH ? 240 : 90)) {
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (points) points.material.uniforms.uPix.value = renderer.getPixelRatio();
}

// ============================================================
// 7. Picking / detail card
// ============================================================
let lastHover = 0;
function onPointerMove(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  // Desktop hover affordance: pointer cursor over any selectable object.
  if (IS_TOUCH || !points || !state.lastAlive || downXY) return;
  const now = performance.now();
  if (now - lastHover < 120) return;
  lastHover = now;
  const sx = e.clientX, sy = e.clientY;
  const pa = posAttr.array;
  let hit = false;
  for (let i = 0; i < state.N; i++) {
    if (!state.lastAlive[i] || !passesFilter(i)) continue;
    _pv.set(pa[i*3], pa[i*3+1], pa[i*3+2]).project(camera);
    if (_pv.z > 1) continue;
    const px = (_pv.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-_pv.y * 0.5 + 0.5) * window.innerHeight;
    if (Math.hypot(px - sx, py - sy) <= 10) { hit = true; break; }
  }
  renderer.domElement.style.cursor = hit ? 'pointer' : '';
}
let downXY = null;
function onPointerDown(e) { downXY = { x: e.clientX, y: e.clientY, t: performance.now() }; }
renderPickBind();
function renderPickBind() {
  document.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y);
    const dt = performance.now() - downXY.t;
    downXY = null;
    if (moved > 6 || dt > 500) return; // drag, not click
    if (e.target !== renderer?.domElement) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    pickAt();
  });
}

// Manual screen-space nearest-point pick. More reliable than Three's Points
// raycaster for a large DynamicDrawUsage buffer whose bounding sphere is not
// recomputed each frame. Projects candidate points to screen and finds the
// closest visible one within a pixel radius, preferring nearer-camera objects.
const _pv = new THREE.Vector3();
function pickAt() {
  if (!points || !state.lastAlive) return;
  const sx = (pointer.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-pointer.y * 0.5 + 0.5) * window.innerHeight;
  const pa = posAttr.array;
  const N = state.N;
  const RADIUS = IS_TOUCH ? 26 : 14; // px — wider hit area for fingers
  hidePickChooser();
  const cands = [];
  for (let i = 0; i < N; i++) {
    if (!state.lastAlive[i] || !passesFilter(i)) continue;
    _pv.set(pa[i*3], pa[i*3+1], pa[i*3+2]).project(camera);
    if (_pv.z > 1) continue; // behind camera / clipped
    const px = (_pv.x * 0.5 + 0.5) * window.innerWidth;
    const py = (-_pv.y * 0.5 + 0.5) * window.innerHeight;
    const d = Math.hypot(px - sx, py - sy);
    if (d > RADIUS) continue;
    // prefer closest-to-cursor, strongly favouring nearer-camera (front) objects
    cands.push({ i, d, s: d + _pv.z * 30 });
  }
  if (!cands.length) return;
  cands.sort((a, b) => a.s - b.s);
  // Unambiguous click: single hit, or the nearest is clearly separated.
  if (cands.length === 1 || cands[1].d - cands[0].d >= 6) { selectObject(cands[0].i); return; }
  showPickChooser(cands.slice(0, 7), sx, sy);
}

// Disambiguation chooser — in dense clusters every object stays reachable.
let pickEl = null;
function hidePickChooser() { if (pickEl) { pickEl.remove(); pickEl = null; } }
function showPickChooser(cands, sx, sy) {
  pickEl = document.createElement('div');
  pickEl.id = 'pickChooser';
  pickEl.innerHTML = `<div class="pc-h">${cands.length} objects here — select one</div>` + cands.map(c => `
    <button class="sr" data-i="${c.i}">
      <span class="sr-name">${state.name[c.i]}</span>
      <span class="sr-meta">${state.norad[c.i]} · ${fullType(state.objType[c.i])} · ${state.ownerCode[c.i]}</span>
    </button>`).join('');
  document.body.appendChild(pickEl);
  const W = pickEl.offsetWidth, H = pickEl.offsetHeight;
  pickEl.style.left = Math.min(Math.max(8, sx + 12), window.innerWidth - W - 8) + 'px';
  pickEl.style.top = Math.min(Math.max(8, sy + 12), window.innerHeight - H - 8) + 'px';
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
  updateColors();
  showDetail(i);
  requestSelOrbit(i);
  if (fly) flyToIndex(i);
}

// One-period orbit trail for the selected object, propagated by the SGP4
// worker in the ECI frame (the render frame), so the path is exact.
function requestSelOrbit(i) {
  clearSelOrbit();
  if (!worker) return;
  const tle2 = state.data.sats[i][3];
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
    t0: performance.now(), dur: 950
  };
}

function showDetail(i) {
  const el = $('#detail');
  $('#dName').textContent = state.name[i];
  $('#dType').textContent = fullType(state.objType[i]);
  const rows = $('#dRows');
  const regBadge = state.objType[i] !== 'PAY'
    ? '<span class="badge na">N/A · non-payload</span>'
    : (state.registered[i] ? '<span class="badge reg">Registered</span>' : '<span class="badge unreg">No UN record</span>');
  rows.innerHTML = `
    <div class="drow"><span class="k">NORAD ID</span><span class="v">${state.norad[i]}</span></div>
    <div class="drow"><span class="k">Intl designator</span><span class="v">${state.intl[i]}</span></div>
    <div class="drow"><span class="k">Responsible State</span><span class="v">${state.ownerName[i]} (${state.ownerCode[i]})</span></div>
    <div class="drow"><span class="k">Constellation</span><span class="v">${state.constLabel[i] || '—'}</span></div>
    <div class="drow"><span class="k">UN registration</span><span class="v">${regBadge}</span></div>
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
        <a href="https://www.unoosa.org/oosa/osoindex/search-ng.jspx" target="_blank" rel="noopener">UNOOSA registry</a>
      </div>
      <button class="dcopy" id="dCopy">Copy link to this object</button>
    </div>`;
  const cp = $('#dCopy');
  if (cp) cp.addEventListener('click', () => {
    const url = location.origin + location.pathname + '?sat=' + state.norad[i];
    navigator.clipboard.writeText(url).then(() => {
      cp.textContent = 'Link copied ✓';
      setTimeout(() => { cp.textContent = 'Copy link to this object'; }, 1600);
    }).catch(() => { cp.textContent = url; });
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
  const tle2 = state.data.sats[i][3];
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
    footnote = '\u2020 Most of the 2,279 cataloged rocket bodies lack public GP element sets and are not propagated here; they are included in the catalog statistics panels.';
  } else if (m === 'state') {
    const codes = ['US','CIS','PRC','UK','JPN','FR','IND','ESA'];
    rows = codes.map(c => [state.stats.owner_names[c] || c, STATE_COLORS[c], countActive(c)]);
    rows.push(['Other States', STATE_COLORS.OTHER, null]);
  } else if (m === 'reg') {
    rows = [['Registered (payload)', REG_COLORS.reg, null],
            ['No UN record (payload)', REG_COLORS.unreg, null],
            ['N/A · non-payload', REG_COLORS.na, null]];
  } else if (m === 'const') {
    rows = [['Starlink', CONST_COLORS.Starlink, count(i=>constKey(state.constLabel[i])==='Starlink')],
            ['OneWeb', CONST_COLORS.OneWeb, count(i=>constKey(state.constLabel[i])==='OneWeb')],
            ['Qianfan/G60', CONST_COLORS.Qianfan, count(i=>constKey(state.constLabel[i])==='Qianfan')],
            ['Guowang', CONST_COLORS.Guowang, count(i=>constKey(state.constLabel[i])==='Guowang')],
            ['Kuiper', CONST_COLORS.Kuiper, count(i=>constKey(state.constLabel[i])==='Kuiper')],
            ['Other constellation', CONST_COLORS.other, null],
            ['Not in constellation', CONST_COLORS.none, null]];
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
  // owners sorted by payload count desc, that exist in dataset
  const present = new Set(state.ownerCode);
  const owners = Object.entries(state.stats.by_owner_payloads)
    .filter(([c]) => present.has(c))
    .sort((a,b) => b[1]-a[1]);
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
    if (o.value === '1') o.textContent = `Registered · ${reg.toLocaleString('en-GB')}`;
    if (o.value === '0') o.textContent = `Unregistered · ${unreg.toLocaleString('en-GB')}`;
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
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Registered versus unregistered payloads by launch year">`;
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
    svg += `<rect x="${x}" y="${yr}" width="${bw}" height="${hr}" fill="#55d18b" rx="1"><title>${y}: ${r} registered</title></rect>`;
    svg += `<rect x="${x}" y="${yu}" width="${bw}" height="${hu}" fill="#ff6b6b" rx="1"><title>${y}: ${u} no record</title></rect>`;
    svg += `<text x="${x + bw/2}" y="${H-padB+9}" text-anchor="middle" font-size="7" fill="#8a9bb5" font-family="monospace">'${String(y).slice(2)}</text>`;
  });
  svg += `</svg>`;
  $('#regChart').innerHTML = svg;

  // table: worst absolute gaps
  const rows = Object.entries(state.stats.registration_by_owner)
    .map(([c, [reg, un]]) => ({ c, reg, un, tot: reg+un }))
    .filter(o => o.tot >= 10)
    .sort((a,b) => b.un - a.un).slice(0, 10);
  const tb = $('#regTable tbody');
  tb.innerHTML = rows.map(o => {
    const name = state.stats.owner_names[o.c] || o.c;
    const pct = o.tot ? Math.round(o.un / o.tot * 100) : 0;
    return `<tr><td>${name}</td><td class="num">${o.reg.toLocaleString()}</td><td class="num hl">${o.un.toLocaleString()}</td><td class="num">${pct}%</td></tr>`;
  }).join('');
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
    tag: 'First dodge of a commercial mega-constellation sat',
    intro: '<strong style="color:var(--accent-warn)">2 September 2019.</strong> ESA\'s Aeolus performed the agency\'s first-ever collision-avoidance manoeuvre against an active commercial constellation satellite — SpaceX Starlink-44 — half an orbit before closest approach.',
    steps: [
      { date: '24 Aug 2019', crit: false, txt: 'Starlink-44 (SpaceX) and Aeolus (ESA Earth-observation mission) are flagged on a converging track. Initial screening from US 18 SPCS conjunction data messages.', prob: null },
      { date: '28 Aug 2019', crit: false, txt: 'Updated conjunction data messages show collision probability rising. ESA begins assessing a possible avoidance manoeuvre.', prob: 'Probability climbing toward threshold' },
      { date: '28–29 Aug 2019', crit: true, txt: 'Collision probability reaches ~1 in 1,000 — ten times ESA\'s 1-in-10,000 action threshold. ESA emails SpaceX to coordinate.', prob: 'P ≈ 1/1,000 · 10× ESA threshold' },
      { date: '29 Aug – 1 Sep 2019', crit: true, txt: 'SpaceX does not respond to ESA follow-ups. The silence is later attributed to a bug in SpaceX\'s on-call paging system. No inter-party coordination occurs.', prob: 'Coordination breakdown — no reply' },
      { date: '2 Sep 2019', crit: true, txt: 'ESA commands Aeolus to fire its thrusters and raise its orbit — half an orbit before closest approach. First time ESA manoeuvred to dodge an active commercial constellation satellite.', prob: 'Manoeuvre executed · T-½ orbit' }
    ],
    caption: '<strong>Article IX OST.</strong> States shall conduct activities with "due regard to the corresponding interests of all other States" and, where an activity "would cause potentially harmful interference," undertake "appropriate international consultations." The Aeolus / Starlink-44 event exposes the mismatch: the operational decision resolved in hours between an inter-governmental agency and a private operator\'s on-call engineers (a paging-system bug delayed SpaceX\'s reply), while the treaty\'s inter-State consultation mechanism had — and has — no operative timeline capable of engaging at that tempo.',
    viz: { mode: 'pair' }
  },
  {
    id: 'iridium', title: 'Iridium 33 / Cosmos 2251', year: '2009',
    tag: 'First accidental collision of two intact satellites',
    intro: '<strong style="color:var(--accent-warn)">10 February 2009, 16:56 UTC.</strong> An active Iridium commercial satellite and a defunct Russian Cosmos 2251 collided at 11.6 km/s over Siberia — the first accidental hypervelocity collision between two intact catalogued satellites. The debris clouds shown in the 3D view are still on orbit seventeen years later.',
    steps: [
      { date: '1993', crit: false, txt: 'Cosmos 2251, a Russian Strela-2M military comms satellite, is launched; it ceases operating in 1995 and becomes derelict, uncontrolled debris.', prob: null },
      { date: '28 Sep 1997', crit: false, txt: 'Iridium 33, an active US commercial mobile-comms satellite (Iridium LLC), is launched into the Iridium constellation.', prob: null },
      { date: '10 Feb 2009 · 15:02 UTC', crit: false, txt: 'CelesTrak\'s SOCRATES tool predicts a 584 m close approach — but it is not flagged as an actionable, high-risk conjunction, and no formal warning reaches either operator in time.', prob: 'Predicted miss: 584 m · not escalated' },
      { date: '10 Feb 2009 · 16:55:59 UTC', crit: true, txt: 'Collision at 778.6 km altitude, relative velocity 11.647 km/s, destroying both satellites. NASA later notes neither operator had requested a JSpOC conjunction assessment for these objects.', prob: 'Impact · 11.647 km/s · both destroyed' },
      { date: '10 Jun 2010', crit: true, txt: 'Catalog update: Cosmos 2251 produced 1,267 cataloged fragments (1,212 on orbit); Iridium 33 produced 521 (498 on orbit).', prob: 'Cataloged fragments: 1,788' },
      { date: 'To date', crit: true, txt: 'Neither the US nor Russia invoked the 1972 Liability Convention or requested Article IX consultations. The matter was never referred to diplomatic channels or a Claims Commission.', prob: 'No Art IX · no Liability Convention claim' }
    ],
    caption: '<strong>Article IX & the Liability Convention.</strong> The first accidental destruction of two intact satellites produced no formal legal process whatsoever: no Article IX consultation, no Liability Convention claim. Fault was hard to assign (Cosmos 2251 was defunct and uncontrolled), and a private operator cannot itself invoke the state-to-state Convention. The case proves that even the clearest "harmful interference" event the treaty regime could imagine generated only silence — the mechanism was never engaged.',
    viz: { mode: 'names', groups: [{ prefix: 'IRIDIUM 33 DEB', color: 0x4fd1e0, label: 'Iridium 33 debris' }, { prefix: 'COSMOS 2251 DEB', color: 0xff6b6b, label: 'Cosmos 2251 debris' }] }
  },
  {
    id: 'fengyun', title: 'Fengyun-1C ASAT test', year: '2007',
    tag: 'Largest debris-generating event on record',
    intro: '<strong style="color:var(--accent-warn)">11 January 2007.</strong> China destroyed its own defunct Fengyun-1C weather satellite with a direct-ascent kinetic kill vehicle at ~865 km — the single largest debris-generating event in history. No advance notification was given to any state. The debris cloud in the 3D view is what remains.',
    steps: [
      { date: '10 May 1999', crit: false, txt: 'Fengyun-1C, a Chinese polar-orbiting weather satellite, is launched from Taiyuan; it stops producing usable imagery in late 2004.', prob: null },
      { date: '11 Jan 2007 · 22:26 UTC', crit: true, txt: 'A direct-ascent SC-19 kinetic-kill vehicle strikes Fengyun-1C at ~863–865 km altitude at ~8–9 km/s, destroying the satellite. No advance notification is given to any other state.', prob: 'Impact · ~8–9 km/s · no notification' },
      { date: '17–18 Jan 2007', crit: false, txt: 'Aviation Week first reports the test; the US National Security Council publicly confirms it on 18 January.', prob: null },
      { date: '19–22 Jan 2007', crit: true, txt: 'The US, Japan, Australia, Canada and others lodge formal diplomatic protests; China declines to confirm or deny for 12 days.', prob: 'Bilateral protests — not Art IX' },
      { date: '23 Jan 2007', crit: false, txt: 'China confirms the test, stating it "was not directed at any country" and reiterating opposition to the weaponization of space.', prob: null },
      { date: 'Ongoing', crit: true, txt: 'By 2010 the catalog held 3,037 fragments (97% on orbit). As of ~April 2025 nearly 2,500 remained on orbit — almost 19% of all tracked debris, still the single largest contributor of any event.', prob: '≈2,500 fragments still on orbit (2025)' }
    ],
    caption: '<strong>Article IX due regard.</strong> A deliberate, unannounced destruction that will pollute the same orbital shells used by every other State for a century drew only bilateral protests — never a formal Article IX consultation. The case proves the "due regard" and "harmful interference" clauses impose no operative constraint on national-security space activity: the most consequential debris event on record triggered no treaty mechanism at all.',
    viz: { mode: 'names', groups: [{ prefix: 'FENGYUN 1C DEB', color: 0xffb347, label: 'Fengyun-1C debris' }] }
  },
  {
    id: 'cosmos1408', title: 'Cosmos 1408 ASAT test', year: '2021',
    tag: 'Nudol test · ISS crew took shelter',
    intro: '<strong style="color:var(--accent-warn)">15 November 2021.</strong> Russia destroyed the defunct Cosmos 1408 with a PL-19 Nudol interceptor at ~480 km, forcing the seven-member ISS crew to shelter in their return capsules. Most of the debris was at low altitude and has since re-entered — a sharp contrast with the high-altitude Fengyun-1C cloud.',
    steps: [
      { date: '1982', crit: false, txt: 'Cosmos 1408, a Soviet-era Tselina-D SIGINT satellite (~2,200 kg), is launched; it later becomes defunct and is used as an ASAT target.', prob: null },
      { date: '15 Nov 2021 · 02:47 UTC', crit: true, txt: 'A PL-19 Nudol direct-ascent interceptor from Plesetsk strikes Cosmos 1408 at ~465–490 km altitude at ~4.6 km/s, destroying it — the first satellite killed by the Nudol system.', prob: 'Impact · ~4.6 km/s' },
      { date: '15 Nov 2021 (same day)', crit: true, txt: 'The seven-member ISS Expedition 66 crew don suits and shelter in their Soyuz and Crew Dragon capsules. The US State Department reports >1,500 trackable debris pieces and hundreds of thousands of smaller fragments.', prob: 'ISS crew sheltered · >1,500 pieces' },
      { date: '7 Mar 2022', crit: false, txt: 'The US catalog has added 1,604 Cosmos 1408 fragments with unique orbital identifications; technical estimates later reach ~1,700–1,800.', prob: '1,604 catalogued fragments' },
      { date: '7 Dec 2022', crit: false, txt: 'The UN General Assembly adopts Resolution 77/41 calling for a moratorium on destructive direct-ascent ASAT testing, 155–9. It is not legally binding.', prob: 'UNGA 77/41 · non-binding' },
      { date: 'By 2025', crit: true, txt: 'Because the intercept was at low altitude, atmospheric drag self-cleaned the cloud: only a handful of Cosmos 1408 fragments still have public element sets — most have re-entered. High-altitude debris (Fengyun-1C) does not clean itself this way.', prob: 'Low-altitude debris self-cleans' }
    ],
    caption: '<strong>Article IX & the limits of soft law.</strong> The clearest modern case of "potentially harmful interference" — debris forcing astronauts into shelter — still produced no Article IX consultation, only a non-binding UNGA resolution the testing states voted against. The case proves the treaty\'s consultation duty does not engage even when human life is directly at risk, and that the altitude of an event, not the law, determines how long its harm persists.',
    viz: { mode: 'names', groups: [{ prefix: 'COSMOS 1408 DEB', color: 0xff6b6b, label: 'Cosmos 1408 debris' }] }
  },
  {
    id: 'luch', title: 'Luch / Olymp GEO proximity ops', year: '2014–26',
    tag: 'Espionage RPO in the GEO ring',
    intro: '<strong style="color:var(--accent-warn)">2014–2026.</strong> Russia\'s Luch (Olymp-K) parked repeatedly within ~10 km of Western telecom satellites in geostationary orbit, listening to their traffic — an "act of espionage," France declared. It generated no debris from the manoeuvres themselves. The 3D view isolates its successor Luch-5X against the Intelsat (ITSO) GEO ring; the original Olymp is no longer on orbit.',
    steps: [
      { date: '28 Sep 2014', crit: false, txt: 'Russia launches Olymp-K (Luch, NORAD 40258), assessed as an FSB/MoD signals-intelligence platform, into geostationary orbit.', prob: null },
      { date: '2015', crit: true, txt: 'Olymp-K parks at 18.1°W directly between Intelsat 901 and Intelsat 7, manoeuvring as close as ~10 km. Intelsat calls the behaviour "not normal"; its calls to the Russian operator go unanswered. US JFCC-Space sends emergency close-approach notifications — an operational notice, not an Article IX consultation.', prob: '~10 km approach · calls unanswered' },
      { date: '26 Nov 2017', crit: true, txt: 'Luch approaches the Franco-Italian military satellite Athena-Fidus to within ~12.5 km.', prob: '~12.5 km to Athena-Fidus' },
      { date: '7 Sep 2018', crit: true, txt: 'French Defence Minister Florence Parly publicly declares: "Trying to listen to your neighbours is not only unfriendly. It\'s an act of espionage." No treaty mechanism is invoked — the response is a diplomatic statement.', prob: '"An act of espionage" · no Art IX' },
      { date: '12 Mar 2023', crit: false, txt: 'Russia launches a successor, Luch-5X / Olymp-K-2 (NORAD 55841); by October 2023 it is tracked trailing Western satellites, repeating the pattern.', prob: 'Successor Luch-5X on station' },
      { date: 'Oct 2025 – 30 Jan 2026', crit: true, txt: 'The original Olymp (NORAD 40258) is decommissioned and moved to a graveyard orbit above GEO in October 2025 — then on 30 January 2026 at 06:09 UTC it fragments there, observed by Swiss SSA firm s2A systems. Analysts assess an impact by untracked debris as the most likely cause, though incomplete passivation has not been excluded.', prob: 'Olymp fragments · suspected debris strike' }
    ],
    caption: '<strong>Article IX due regard, without collision.</strong> Luch/Olymp proves that "harmful interference" under Article IX need not involve any physical contact: years of eavesdropping proximity operations against allied satellites drew emergency notifications and a ministerial "espionage" charge, but never a formal Article IX consultation. And in a closing irony, the platform that spent a decade exploiting the shared orbital environment ended fragmented in its graveyard orbit — most plausibly struck by that same environment\'s untracked debris.',
    viz: { mode: 'geo', norad: 55841, noradColor: 0xff6b6b, ownerCode: 'ITSO', ownerColor: 0x4fd1e0 }
  }
];

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;

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
      <div class="cd">"Appropriate international consultations" under Article IX have no trigger threshold and no timeline — and have never been formally invoked for an on-orbit conjunction in ~60 years.</div>
      <div class="cx">No trigger · no timeline · never invoked</div>
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
  if (cur && scenTimer) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      note: '<strong>Illustrative.</strong> Starlink-44 has since decayed and Aeolus (NORAD 43600) was de-orbited in 2023, so neither is in the current catalog. The 3D view shows a representative present-day Starlink alongside a sun-synchronous Earth-observation payload to convey the crossing geometry. For the actual 2019 objects propagated from archival element sets, press “⏱ Replay the event”.'
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
    let note = `<strong>Live catalog.</strong> Isolating ${parts.join(' and ')} — objects with public element sets still on orbit today. `;
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
    const note = `<strong>Live catalog · GEO ring.</strong> <span style="color:${luchHex}">${luchName}</span> (NORAD ${viz.norad}) is isolated against the <span style="color:${itsoHex}">${itso.size} Intelsat (ITSO) GEO payloads</span> it and its predecessor shadowed. The original Olymp (NORAD 40258) is no longer intact — it was moved to a graveyard orbit in October 2025 and fragmented there on 30 January 2026, most plausibly struck by untracked debris, so it cannot be shown here.`;
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
      const inc = parseFloat(state.data.sats[i][3].substring(8, 16));
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
  if (!worker || pair.length < 2) return;
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
    s.src = './js/satellite.min.js?v=1.3.0'; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return _satLibP;
}
async function loadHistData() {
  if (!histData) histData = await (await fetch('./data/histevents.json?v=1.3.0')).json();
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
  if (p < 0.55) return H.t0 + (p / 0.55) * (a - H.t0);
  if (p < 0.90) return a + ((p - 0.55) / 0.35) * (H.keyT - a);
  return H.keyT + ((p - 0.90) / 0.10) * (H.t1 - H.keyT);
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
    for (const o of H.objs) {
      o.dead = true;
      o.marker.material.opacity = 0.3;
      o.trailLine.material.opacity = 0.22;
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
  else line = H.ev.keyLabel;
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
  state.simTime = t;
  histPropagate(H, t);
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
    const lead = H.objs[0].pos;
    if (lead.lengthSq() > 1) {
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
  if (points) points.visible = true;
  state.speed = H.saved.speed; state.playing = true;
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
    <div class="stat-cell"><div class="n">${(lag.watching_unregistered||0).toLocaleString('en-GB')}</div><div class="l">With no registration record — under watch</div></div>
    <div class="stat-cell"><div class="n">${(lag.flips_observed||0).toLocaleString('en-GB')}</div><div class="l">Registrations observed since launch of this index</div></div>
    <div class="stat-cell"><div class="n">${median}</div><div class="l">Median observed lag, launch → registration</div></div>`;

  const daysRunning = lag.days_running || 0;
  if (!lag.recent_flips || lag.recent_flips.length === 0) {
    flipsEl.innerHTML = `
      <div class="lag-empty"><span class="lag-dot"></span>
        No registrations have flipped from "no record" to "registered" yet — longitudinal observation began ${lag.started}${daysRunning ? ` (day ${daysRunning})` : ''}. As objects are registered with UNOOSA, the lag from launch to registration will be measured and accumulated here on each daily refresh.
      </div>`;
  } else {
    const rows = lag.recent_flips.slice(0, 12).map(f => `
      <tr><td>${f.name || f.norad || '—'}</td><td>${f.owner || ''}</td>
      <td class="num">${f.launch || '—'}</td><td class="num">${f.registered || '—'}</td>
      <td class="num hl">${f.lag_days != null ? f.lag_days.toLocaleString('en-GB') : '—'}</td></tr>`).join('');
    flipsEl.innerHTML = `<div class="lag-scroll"><table class="dt"><thead><tr>
      <th>Object</th><th>Owner</th><th>Launched</th><th>Registered</th><th class="num">Lag (days)</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  methodEl.innerHTML = `<strong>Method.</strong> Each daily refresh compares the tracked payload catalog against UNOOSA registration records. When a previously unregistered payload gains a registration record, the instrument records the elapsed days from launch and updates the running median. Figures update automatically — this panel measures what it observes from the day it began, not a retrospective estimate.`;
}

// ============================================================
// 11c. Supervisory machinery — national space legislation (Task B)
// ============================================================
// Joins site/data/national_law.json (UNOOSA national space-law database, keyed
// by SATCAT owner code) with the live payload populations in stats.json. All
// counts are computed at runtime; a daily refresh of either file re-derives them.
function buildSupervision() {
  const nl = state.natlaw;
  const heroEl = $('#supHero'), barEl = $('#supBar'), legEl = $('#supLegend');
  const noLawEl = $('#supNoLaw'), footEl = $('#supFoot');
  if (!nl || !state.stats) {
    if (heroEl) heroEl.innerHTML = '';
    if (footEl) footEl.textContent = 'National space-law dataset unavailable.';
    return;
  }
  const pay = state.stats.by_owner_payloads || {};
  const names = state.stats.owner_names || {};
  // Classify every owner's payloads by the supervising State's legislation.
  const cat = { yes: 0, no: 0, consortium: 0, unknown: 0 };
  const noLawOwners = [];
  let classified = 0, total = 0;
  for (const [code, n] of Object.entries(pay)) {
    total += n;
    const rec = nl.states[code];
    let law = rec ? rec.law : 'unknown';
    if (!['yes','no','consortium','unknown'].includes(law)) law = 'unknown';
    cat[law] += n; classified += n;
    if (law === 'no') noLawOwners.push({ code, n, name: (rec && rec.state) || names[code] || code, rec });
  }
  const COL = { yes: '#55d18b', consortium: '#4fd1e0', unknown: '#8a9bb5', no: '#ff6b6b' };
  const LAB = { yes: 'Dedicated national space law', consortium: 'Consortium / delegated regime', unknown: 'No data / unattributed', no: 'No dedicated space law' };

  const pct = (v) => total ? (v / total * 100) : 0;
  heroEl.innerHTML = `
    <div class="big">${Math.round(pct(cat.no)).toLocaleString('en-GB')}%</div>
    <div class="cap" style="margin-top:6px">of catalogued payloads are supervised by a State that has <strong>no dedicated national space-law framework</strong> — the domestic machinery Article VI presumes for "authorization and continuing supervision." ${cat.no.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} payloads.</div>`;

  const order = ['yes','consortium','unknown','no'];
  barEl.innerHTML = `<div class="stack-bar">${order.map(k =>
    `<span style="width:${pct(cat[k]).toFixed(2)}%;background:${COL[k]}" title="${LAB[k]}: ${cat[k].toLocaleString('en-GB')} (${pct(cat[k]).toFixed(1)}%)"></span>`).join('')}</div>`;
  legEl.innerHTML = order.map(k =>
    `<span><i style="background:${COL[k]}"></i>${LAB[k]} · ${cat[k].toLocaleString('en-GB')} (${pct(cat[k]).toFixed(1)}%)</span>`).join('');

  // Largest payload populations under a State with no dedicated space law.
  noLawOwners.sort((a,b) => b.n - a.n);
  const top = noLawOwners.slice(0, 8);
  if (top.length === 0) {
    noLawEl.innerHTML = '<div class="cap">No owner with a substantial payload population currently falls in the "no dedicated space law" category.</div>';
  } else {
    const rows = top.map(o => {
      const instr = o.rec && o.rec.instrument ? o.rec.instrument : 'No comprehensive space act in force';
      return `<tr><td>${o.name}</td><td class="num hl">${o.n.toLocaleString('en-GB')}</td><td style="font-size:11px;color:var(--txt-dim)">${instr}</td></tr>`;
    }).join('');
    noLawEl.innerHTML = `<div class="lag-scroll"><table class="dt"><thead><tr>
      <th>State (owner)</th><th class="num">Payloads</th><th>Statutory position</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  footEl.innerHTML = `<strong>Method.</strong> Payload populations from the live catalog are joined to the UNOOSA national space-law database by SATCAT owner code. "No dedicated space law" means the launching/supervising State has no comprehensive statutory authorization-and-supervision regime in force (registration-only or non-statutory policy regimes are counted as "no dedicated space law"). Consortium entries (e.g. Intelsat, Eutelsat, ESA) are supervised through delegated or member-State machinery rather than a single national act. Source: <a href="${nl.source_url}" target="_blank" rel="noopener">${nl.source}</a>.`;
}

// ============================================================
// 11e. Provenance additions (Phase 2 · Task E)
// ============================================================
function buildProvenance() {
  const nl = state.natlaw;
  const natEl = $('#provNatlaw'), ledEl = $('#provLedger'), casesEl = $('#provCases');
  if (natEl) {
    natEl.innerHTML = nl
      ? `<div class="pc-h">National space law</div><a href="${nl.source_url}" target="_blank" rel="noopener">${nl.source}</a> — ${Object.keys(nl.states).length} States/entities classified by statutory position. Snapshot generated ${nl.generated}. Joined to live payload populations by SATCAT owner code.`
      : `<div class="pc-h">National space law</div>Dataset unavailable.`;
  }
  if (ledEl) {
    const lag = state.lag;
    ledEl.innerHTML = lag
      ? `<div class="pc-h">Registration Lag Index</div>Longitudinal ledger begun ${lag.started}; ${lag.days_running||0} day(s) of observation, ${(lag.flips_observed||0).toLocaleString('en-GB')} registration events recorded so far. Each daily refresh compares the tracked catalog against UNOOSA registration records and appends any launch→registration lag it observes. This is a forward-looking measurement, not a retrospective estimate.`
      : `<div class="pc-h">Registration Lag Index</div>Dataset unavailable.`;
  }
  if (casesEl) {
    const cases = [
      { t: 'Aeolus / Starlink-44 (2019)', links: [['ESA — spacecraft dodges a large constellation', 'https://www.esa.int/Safety_Security/Space_Debris/ESA_spacecraft_dodges_large_constellation']] },
      { t: 'Iridium 33 / Cosmos 2251 (2009)', links: [['NASA NTRS technical analysis', 'https://ntrs.nasa.gov/api/citations/20100008433/downloads/20100008433.pdf'], ['Watson Farley & Williams — legal analysis', 'https://www.wfw.com/articles/collisions-in-space-may-the-force-of-law-be-with-you/']] },
      { t: 'Fengyun-1C ASAT test (2007)', links: [['NASA Orbital Debris Program Office', 'https://ntrs.nasa.gov/api/citations/20070007324/downloads/20070007324.pdf'], ['CSET — Mapping Space Debris', 'https://cset.georgetown.edu/publication/mapping-space-debris/']] },
      { t: 'Cosmos 1408 ASAT test (2021)', links: [['NASA ODPO Quarterly News Vol. 26-1', 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv26i1.pdf'], ['Kosmos 1408 — overview', 'https://en.wikipedia.org/wiki/Kosmos_1408']] },
      { t: 'Luch / Olymp GEO proximity ops (2014–26)', links: [['CSIS Satellite Dashboard analysis', 'https://satellitedashboard.org/analysis/luch-olymp-athena-fidus/'], ['Défense — Parly "act of espionage" (Defense News)', 'https://www.defensenews.com/space/2018/09/07/espionage-french-defense-head-charges-russia-of-dangerous-games-in-space/'], ['Luch destroyed by debris (Militarnyi)', 'https://militarnyi.com/en/news/russian-spy-satellite-luch-completely-destroyed-after-collision-with-space-debris/']] },
      { t: 'Article IX never formally invoked', links: [['GCSP — In Focus (Schrogl)', 'https://www.gcsp.ch/sites/default/files/2026-02/In%20Focus_26_Schrogl.pdf']] },
      { t: 'Starlink autonomous collision avoidance', links: [['Space.com — Starlink avoidance manoeuvres', 'https://www.space.com/spacex-starlink-50000-collision-avoidance-maneuvers-space-safety'], ['Six-month manoeuvre totals (FCC filing, via Gigazine)', 'https://gigazine.net/gsc_news/en/20260706-spacex-starlink-satelite']] }
    ];
    casesEl.innerHTML = cases.map(c =>
      `<div class="pc"><div class="pc-h">${c.t}</div>${c.links.map(([n,u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</div>`).join('');
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

  // time
  $('#tPlay').addEventListener('click', () => {
    if (histMode) { // during a replay, play/pause controls the replay itself
      histMode.paused = !histMode.paused;
      $('#playPath').setAttribute('d', !histMode.paused ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z');
      return;
    }
    state.playing = !state.playing;
    $('#playPath').setAttribute('d', state.playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z');
  });
  $('#tNow').addEventListener('click', () => { if (histMode) histExit(); state.simTime = Date.now(); });
  $$('.timebar [data-speed]').forEach(btn => btn.addEventListener('click', () => {
    if (histMode) return; // replay owns the clock
    $$('.timebar [data-speed]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.speed = parseInt(btn.dataset.speed);
  }));

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
  }

  // detail close
  $('#dClose').addEventListener('click', () => { $('#detail').classList.remove('show'); selectedIndex = -1; if(!state._scenIsolate) updateColors(); selMarker.visible=false; clearSelOrbit(); });

  // catalogue search (name / NORAD / international designator)
  wireSearch();
  wireUITail();
}

// Citation formats — filled at runtime so the accessed date is always current.
function fillCitations() {
  const APP_VERSION = '1.3.0';
  const acc = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const os = $('#citeOscola'), bib = $('#citeBibtex');
  if (os) os.textContent = `Hallam Burnapp, 'STARS Observatory' (v${APP_VERSION}, University of Aberdeen 2026) <https://starsobservatory.org> accessed ${acc}. DOI: 10.5281/zenodo.22662849.`;
  if (bib) bib.textContent = `@software{burnapp_stars_2026,
  author  = {Burnapp, Hallam},
  title   = {STARS Observatory},
  version = {${APP_VERSION}},
  year    = {2026},
  organization = {University of Aberdeen},
  url     = {https://starsobservatory.org},
  doi     = {10.5281/zenodo.22662849}
}`;
}

function wireUITail() {

  // panels / drawer
  $$('.tabbar button').forEach(btn => btn.addEventListener('click', () => openPanel(btn.dataset.panel)));
  $$('#drawerNav button').forEach(btn => btn.addEventListener('click', () => openPanel(btn.dataset.panel)));
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#footProv').addEventListener('click', () => openPanel('prov'));
  $('#footCite').addEventListener('click', () => {
    openPanel('prov');
    setTimeout(() => $('#citeSec')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  });
  fillCitations();
  $$('.copybtn').forEach(b => b.addEventListener('click', () => {
    const src = $('#' + b.dataset.copy);
    navigator.clipboard.writeText(src.textContent).then(() => {
      const t = b.textContent; b.textContent = 'Copied ✓';
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
    if (e.key === '/' && document.activeElement !== inp &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); inp.focus();
    }
  });
}

// Deep link: ?sat=<NORAD> selects and flies to an object once positions exist.
function applyPermalink() {
  const q = new URLSearchParams(location.search).get('sat');
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
  reggap: { tag: 'Analytical panel · 02', title: 'UN registration gap' },
  art9: { tag: 'Analytical panel · 03', title: 'Article IX — Decision-time compression' },
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
}
function closeDrawer() { $('#drawer').classList.remove('open'); }

// ============================================================
// Boot
// ============================================================
async function boot() {
  try {
    const { tle1, tle2 } = await loadData();
    initThree();
    buildPointCloud();
    populateFilters();
    renderLegend();
    buildArt6();
    buildRegGap();
    buildLagIndex();
    buildSupervision();
    buildThreeClocks();
    buildScenarioCards();
    selectScenario(0);
    buildProvenance();
    wireUI();
    await startWorker(tle1, tle2);
    // first propagation
    requestPropagation(state.simTime);
    // wait for first positions then hide loader
    const waitReady = setInterval(() => {
      if (state.ready) {
        clearInterval(waitReady);
        setLoad('Live', 100);
        applyPositions();
        applyPermalink();
        setTimeout(() => { const l = $('#loader'); if (l) l.style.display = 'none'; }, 350);
      }
    }, 80);
    animate();
  } catch (err) {
    console.error(err);
    const st = $('#loadStatus'); if (st) { st.textContent = 'Error: ' + err.message; st.style.color = '#ff6b6b'; }
  }
}

boot();
window.__OBS = state; // debug handle for QA
// QA-only helpers: expose projection + select so automated tests can verify picking
window.__QA = {
  hist() {
    if (!histMode) return null;
    return { cam: camera.position.toArray(), userCam: histMode.userCam, camDist: histMode.camDist, camDir: histMode.camDir && histMode.camDir.toArray(),
      objs: histMode.objs.map(o => ({ pos: o.pos.toArray(), vis: o.grp.visible, hasParent: !!o.grp.parent, mScale: o.marker.scale.toArray(), lScale: o.label.scale.toArray(), lPos: o.label.position.toArray() })) };
  },
  screenOf(idx) {
    const pa = posAttr.array;
    const v = new THREE.Vector3(pa[idx*3], pa[idx*3+1], pa[idx*3+2]);
    v.project(camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, z: v.z };
  },
  select(idx) { selectObject(idx); },
  get selected() { return selectedIndex; },
  setCam(x, y, z) { camera.position.set(x, y, z); controls.update(); },
  get sunDir() { return sunDirWorld ? sunDirWorld.toArray() : null; },
  rayTest(nx, ny) {
    pointer.x = nx; pointer.y = ny;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(points);
    return { count: hits.length, first: hits[0] ? { index: hits[0].index, dist: hits[0].distanceToRay } : null };
  }
};
