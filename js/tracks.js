// Track geometry. Real outlines come from the open bacinger/f1-circuits GeoJSON
// (≈40 circuits). Anything not in it (Le Mans, Daytona, Sebring, Fuji…) gets a
// generated stand-in shape so the race view still works everywhere.

import { cornerLabels } from './corners.js';

const GEO_URL = 'https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@master/f1-circuits.geojson';

const ALIASES = [
  [/spa/i, 'be-1925'], [/monza/i, 'it-1922'], [/silverstone/i, 'gb-1948'],
  [/barcelona|catalunya/i, 'es-1991'], [/paul ricard|castellet/i, 'fr-1969'],
  [/imola|enzo e dino/i, 'it-1953'], [/n[uü]rburgring/i, 'de-1927'],
  [/algarve|portim/i, 'pt-2008'], [/suzuka/i, 'jp-1962'], [/americas|\bcota\b|austin/i, 'us-2012'],
  [/interlagos|carlos pace|s[aã]o paulo/i, 'br-1940'], [/bahrain|sakhir/i, 'bh-2002'],
  [/losail|lusail|qatar/i, 'qa-2004'], [/yas marina|abu dhabi/i, 'ae-2009'], [/sepang/i, 'my-1999'],
  [/red bull ring|spielberg/i, 'at-1969'], [/hockenheim/i, 'de-1932'], [/hungaroring/i, 'hu-1986'],
  [/zandvoort/i, 'nl-1948'], [/mugello/i, 'it-1914'], [/watkins/i, 'us-1956'],
  [/indianapolis/i, 'us-1909'], [/magny/i, 'fr-1960'], [/estoril/i, 'pt-1972'],
  [/kyalami/i, 'za-1961'], [/shanghai/i, 'cn-2004'], [/gilles|montr[eé]al/i, 'ca-1978'],
  [/albert park|melbourne/i, 'au-1953'], [/jeddah/i, 'sa-2021'], [/istanbul/i, 'tr-2005'],
  [/miami/i, 'us-2022'], [/las vegas/i, 'us-2023'], [/baku/i, 'az-2016'],
  [/g[aá]lvez|buenos aires/i, 'ar-1952'], [/hermanos|mexico city/i, 'mx-1962'],
];

const STEP = 4; // metres between resampled points

let geoPromise = null;
function loadGeo() {
  geoPromise ??= fetch(GEO_URL).then((r) => r.json()).catch(() => null);
  return geoPromise;
}

/** Returns a Track: { name, real, pts:[{x,y}] metres, length, curv:[] , sectors:[s1,s2] } */
export async function loadTrack(circuitName) {
  const alias = ALIASES.find(([re]) => re.test(circuitName));
  if (alias) {
    const geo = await loadGeo();
    const f = geo?.features.find((ft) => ft.properties.id === alias[1]);
    if (f) {
      const coords = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
      const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
      const k = Math.cos((lat0 * Math.PI) / 180);
      const raw = coords.map(([lon, lat]) => ({ x: lon * 111320 * k, y: -lat * 110540 }));
      const track = buildTrack(raw, f.properties.Name, true);
      track.labels = cornerLabels(track, [circuitName, f.properties.Name]);
      track.toLatLon = (p) => ({ lat: -p.y / 110540, lon: p.x / (111320 * k) });
      return track;
    }
  }
  const track = buildTrack(generatedShape(circuitName), circuitName, false);
  track.labels = cornerLabels(track, [circuitName]);
  return track;
}

// Deterministic pseudo-random closed loop so each unknown circuit gets its own shape.
function generatedShape(seedText) {
  let seed = [...seedText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const n = 14;
  const ctrl = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 700 + rnd() * 600;
    return { x: Math.cos(a) * r * 1.5, y: Math.sin(a) * r };
  });
  // Catmull-Rom through the control points
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let t = 0; t < 1; t += 0.05) {
      const t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

export function buildTrack(raw, name, real) {
  // close loop
  const first = raw[0], last = raw[raw.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > 1) raw = [...raw, first];

  // resample to uniform spacing
  const pts = [];
  let carry = 0;
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i], b = raw[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = carry;
    while (d < seg) {
      const t = d / seg;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += STEP;
    }
    carry = d - seg;
  }
  const length = pts.length * STEP;

  // heading + smoothed curvature per point
  const n = pts.length;
  const heading = pts.map((p, i) => {
    const q = pts[(i + 3) % n], o = pts[(i - 3 + n) % n];
    return Math.atan2(q.y - o.y, q.x - o.x);
  });
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let curv = heading.map((h, i) => Math.abs(wrap(heading[(i + 1) % n] - h)) / STEP);
  for (let pass = 0; pass < 2; pass++) {
    const W = 6;
    curv = curv.map((_, i) => {
      let s = 0;
      for (let k = -W; k <= W; k++) s += curv[(i + k + n) % n];
      return s / (2 * W + 1);
    });
  }

  // Corner speed factor: fast on straights, slow in tight corners. Look ahead so
  // cars brake before the apex rather than at it.
  const cmax = 1 / 25; // ~25 m radius hairpin
  const base = curv.map((c) => 0.32 + 0.68 * (1 - Math.min(1, c / cmax)) ** 1.6);
  const LOOK = Math.round(60 / STEP);
  const speed = base.map((_, i) => {
    let m = 1;
    for (let k = 0; k < LOOK; k++) m = Math.min(m, base[(i + k) % n] + k * 0.006);
    return m;
  });

  // Corners for incident text: local curvature peaks.
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (curv[i] > cmax * 0.18 && curv[i] >= curv[(i - 1 + n) % n] && curv[i] >= curv[(i + 1) % n]) {
      if (!corners.length || i - corners[corners.length - 1] > 90 / STEP) corners.push(i);
    }
  }

  return { name, real, pts, heading, speed, length, step: STEP, corners };
}

/** Position on track for a lap fraction p (any real number). */
export function sample(track, p) {
  const n = track.pts.length;
  const f = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(f), t = f - i;
  const a = track.pts[i], b = track.pts[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, i, h: track.heading[i] };
}

/** Text for where on the lap p is, e.g. "T5 (Les Combes)". */
export function cornerAt(track, p) {
  const x = ((p % 1) + 1) % 1;
  const turns = (track.labels || []).filter((l) => l.kind === 'turn');
  if (!turns.length) return 'the track';
  // nearest turn at or just before the car
  let best = turns[turns.length - 1];
  for (const l of turns) if (l.at <= x + 0.01) best = l;
  const num = best.n ? `T${best.n}` : '';
  return best.name ? (num ? `${num} (${best.name})` : best.name) : num;
}
