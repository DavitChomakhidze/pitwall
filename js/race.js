import { seriesById } from './series.js';
import { eventStatus, fromISO } from './schedule.js';
import { loadTrack, sample } from './tracks.js';
import { RaceSim, fmtLap, fmtClock } from './sim.js';
import { AlKamelClient, ALKAMEL_FEEDS } from './alkamel.js';
import { LiveRace } from './live.js';
import { cornerText, nextCorner } from './corners.js';
import { TrackWeather } from './weather.js';
import { loadStandings } from './standings.js';
import { cornerAt } from './tracks.js';

let weather = null;
const GRIP = { wet: 0.88, damp: 0.94, dry: 1 };

const CORNER_MODES = ['names', 'numbers', 'off'];
let cornerMode = (() => { try { return localStorage.getItem('racehub:corners') || 'names'; } catch { return 'names'; } })();

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const q = new URLSearchParams(location.search);
const ev = {
  seriesId: q.get('s') || 'wec', name: q.get('n') || 'Demo race', circuit: q.get('c') || 'Circuit de Spa-Francorchamps',
  location: q.get('l') || '', start: q.get('a'), end: q.get('b'), round: q.get('r'),
};
const series = seriesById(ev.seriesId) || seriesById('wec');
const feed = ALKAMEL_FEEDS[series.id];

// `model` is either the RaceSim or a LiveRace — both expose the same interface.
let model, track, view;
let simModel = null;
let client = null;
let speedX = 1;
let towerFilter = 'all';
let selected = null; // car id with onboard open
let lastFrame = performance.now();
let lastTower = 0;

const carById = (id) => model.cars.find((c) => String(c.id) === String(id));
const lapsOf = (c) => (c.laps ?? c.lap);

// ---------------------------------------------------------------- header

function header() {
  document.title = `${ev.name} · Pitwall`;
  $('seriesBadge').textContent = series.short;
  $('seriesBadge').style.setProperty('--series', series.color);
  $('raceTitle').textContent = ev.name;
  let status = '';
  if (ev.start && ev.end) {
    const st = eventStatus(ev);
    const d = (s) => fromISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    status = st === 'live' ? 'Race weekend live now' : st === 'done' ? `Finished ${d(ev.end)}` : `Race day ${d(ev.end)}`;
  }
  $('raceSub').textContent = [ev.round && `Round ${ev.round}`, ev.circuit, ev.location, status].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- model switching

function setModel(m) {
  model = m;
  track = m.track;
  if (ob) { ob.el.remove(); ob = null; selected = null; }
  prevPos.clear();
  champDrawn = false;
  $('toasts').replaceChildren();
  buildMap();
  buildTabs();
  drawTower();
  drawClock();
  $('speedCtl').hidden = m.isLive;
  $('source').classList.toggle('live', m.isLive);
  if (m.isLive && weather) {
    // replay race control history quietly so "declared wet" etc. is known
    weather.rc = { wet: false, spots: [] };
    const log = m.client.one('race_control')?.raceControlMessages?.log || {};
    for (const msg of Object.values(log).sort((a, b) => a.date - b.date)) weather.readRaceControl(msg.message, track.labels);
    drawWet();
  }
  drawWeather();
}

async function useSimulation() {
  if (client) { client.close(); client = null; }
  if (!simModel) {
    const simTrack = await loadTrack(ev.circuit);
    const seed = [...`${ev.seriesId}${ev.name}`].reduce((a, ch) => (a * 33 + ch.charCodeAt(0)) >>> 0, 5381);
    simModel = new RaceSim({ series, track: simTrack, eventName: ev.name, seed });
    simModel.on(toast);
    simModel.gripAt = (p) => GRIP[weather?.levelAt(p) || 'dry'];
  }
  $('source').value = 'sim';
  setModel(simModel);
}

/** Connect to Al Kamel. sessionId = null follows the feed's current session. */
function useLive(sessionId = null, { auto = false } = {}) {
  if (client) client.close();
  client = new AlKamelClient(feed, { sessionId });
  const live = new LiveRace(client, series);
  live.on(toast);
  let shown = false;
  let announced = false;
  client.addEventListener('change', () => {
    fillSessions();
    // The feed went live while we were showing something else.
    if (shown && model !== live && client.feedInfo?.running && !announced && !sessionId) {
      announced = true;
      showBanner(`<span><span class="timing-pill on">LIVE</span> ${esc(live.label() || `${series.short} session`)} is running now.</span>`, [
        ['Watch live', () => { hideBanner(); setModel(live); $('source').value = 'live'; }, true],
        ['Later', hideBanner],
      ]);
    }
    if (!shown && live.ready && live.client.one('standings')) {
      shown = true;
      // In auto mode only take over when the feed is actually running.
      if (auto && !client.feedInfo?.running) { offerLatest(live); return; }
      hideBanner();
      setModel(live);
      $('source').value = sessionId || 'live';
    }
  });
  client.connect();
  if (!auto) showBanner(`Connecting to Al Kamel live timing…`);
}

// ---------------------------------------------------------------- source picker

function buildSourcePicker() {
  const sel = $('source');
  sel.innerHTML = '<option value="sim">Simulation</option>';
  if (feed) {
    sel.insertAdjacentHTML('beforeend', '<option value="live">Live timing · Al Kamel</option><optgroup label="Recorded sessions" id="sessGroup"></optgroup>');
  }
  sel.onchange = () => {
    const v = sel.value;
    if (v === 'sim') { hideBanner(); useSimulation(); } else useLive(v === 'live' ? null : v);
  };
}

let sessionsKey = '';
function fillSessions() {
  if (!client) return;
  const list = client.sessionList();
  const key = list.map((s) => s.id + s.event).join();
  if (!list.length || key === sessionsKey) return;
  sessionsKey = key;
  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('sessGroup').innerHTML = list.slice(0, 40).map((s) => {
    const champ = s.champ.replace(/^(IMSA WeatherTech SportsCar Championship|FIA World Endurance Championship)$/, '★ $1');
    return `<option value="${s.id}">${fmt(s.date)} · ${esc(s.name)} — ${esc(champ || s.event)}</option>`;
  }).join('');
  if (client.pinnedSession) $('source').value = client.pinnedSession;
}

function offerLatest(live) {
  const label = live.label() || 'latest session';
  showBanner(`<span>No live ${series.short} session on Al Kamel right now. Latest: <b>${esc(label)}</b> (${live.status().isFinished ? 'finished' : 'not running'}).</span>`, [
    ['Show it', () => { hideBanner(); setModel(live); $('source').value = 'live'; }, true],
    ['Keep simulation', hideBanner],
  ]);
}

function showBanner(html, buttons = []) {
  const b = $('banner');
  b.innerHTML = html;
  for (const [label, fn, primary] of buttons) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (primary) btn.className = 'primary';
    btn.onclick = fn;
    b.append(btn);
  }
  b.hidden = false;
}
function hideBanner() { $('banner').hidden = true; }

// ---------------------------------------------------------------- map

function buildMap() {
  const svg = $('trackSvg');
  const xs = track.pts.map((p) => p.x), ys = track.pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY);
  const pad = size * 0.08;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const w = size * 0.016;
  view = { size, w, carR: size * 0.0135 };

  const d = 'M' + track.pts.filter((_, i) => i % 2 === 0).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L') + 'Z';
  svg.innerHTML = '';
  svg.append(
    mk('path', { d, class: 'track-outline', 'stroke-width': w * 1.9 }),
    mk('path', { d, class: 'track-inner', 'stroke-width': w * 0.55 }),
  );
  view.wetLayer = mk('g', {});
  svg.append(view.wetLayer);
  drawWet();
  view.yellowLayer = mk('g', {});
  view.yellowKey = '';
  svg.append(view.yellowLayer);

  // start/finish line
  const s0 = sample(track, 0);
  const nx = -Math.sin(s0.h), ny = Math.cos(s0.h);
  svg.append(mk('line', { class: 'sf-line', 'stroke-width': w * 0.35, x1: s0.x - nx * w * 1.4, y1: s0.y - ny * w * 1.4, x2: s0.x + nx * w * 1.4, y2: s0.y + ny * w * 1.4 }));

  view.labelsLayer = mk('g', {});
  svg.append(view.labelsLayer);
  drawCornerLabels();

  view.carsLayer = mk('g', {});
  svg.append(view.carsLayer);
  view.carEls = new Map();

  $('legend').innerHTML = model.classes().map(([cls, color]) => `<span><i class="ring" style="border-color:${color}"></i>${esc(cls)}</span>`).join('');
  updateNote();
}

// T1 / T2 … and corner names, placed on the outside of each corner.
function drawCornerLabels() {
  const layer = view.labelsLayer;
  layer.replaceChildren();
  $('cornerBtn').textContent = `Corners: ${{ names: 'numbers + names', numbers: 'numbers', off: 'off' }[cornerMode]}`;
  if (cornerMode === 'off' || !track.labels?.length) return;

  const { size, w } = view;
  const numSize = size * 0.021, nameSize = size * 0.016;
  const cx = track.pts.reduce((a, p) => a + p.x, 0) / track.pts.length;
  const cy = track.pts.reduce((a, p) => a + p.y, 0) / track.pts.length;
  const placed = [];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  for (const l of track.labels) {
    const showName = cornerMode === 'names' && l.name;
    if (!l.n && !showName) continue;
    const s = sample(track, l.at);
    const nx = -Math.sin(s.h), ny = Math.cos(s.h); // right-hand side of travel
    const before = sample(track, l.at - 25 / track.length), after = sample(track, l.at + 25 / track.length);
    const turning = wrap(after.h - before.h);
    let side;
    if (l.kind === 'turn' && Math.abs(turning) > 0.15) side = turning > 0 ? -1 : 1; // outside of the bend
    else side = (s.x - cx) * nx + (s.y - cy) * ny > 0 ? 1 : -1; // away from the infield

    // Rough text box, then try: outside near, outside far, inside near, inside far.
    // If nothing fits, drop the name and keep just the number.
    const box = (withName) => ({
      w: Math.max(numSize * 1.7, withName ? l.name.length * nameSize * 0.56 : 0),
      h: (l.n ? numSize : 0) + (withName ? nameSize * 1.2 : 0),
    });
    const overlaps = (x, y, b) => placed.some((p) => Math.abs(p.x - x) * 2 < p.w + b.w && Math.abs(p.y - y) * 2 < p.h + b.h);
    let spot = null, withName = showName;
    for (const attempt of [true, false]) {
      if (!attempt && !withName) break;
      if (!attempt) withName = false;
      if (!withName && !l.n) break;
      const b = box(withName);
      for (const [sd, k] of [[side, 2.6], [side, 4.6], [-side, 2.6], [-side, 4.6]]) {
        const x = s.x + nx * sd * w * k, y = s.y + ny * sd * w * k + (withName && l.n ? nameSize * 0.5 : 0);
        if (!overlaps(x, y, b)) { spot = { x, y: y - (withName && l.n ? nameSize * 0.5 : 0), sd, b }; break; }
      }
      if (spot) break;
    }
    if (!spot) continue;
    side = spot.sd;
    const { x, y } = spot;
    placed.push({ x, y: y + (withName && l.n ? nameSize * 0.5 : 0), w: spot.b.w, h: spot.b.h });

    layer.append(mk('line', {
      class: 'corner-tick', 'stroke-width': w * 0.12,
      x1: s.x + nx * side * w * 1.1, y1: s.y + ny * side * w * 1.1, x2: x - nx * side * numSize * 0.7, y2: y - ny * side * numSize * 0.7,
    }));
    const g = mk('g', {});
    if (l.n) {
      const t = mk('text', { class: 'corner-num', x, y, 'font-size': numSize });
      t.textContent = `T${l.n}`;
      g.append(t);
    }
    if (withName) {
      const t = mk('text', { class: `corner-name ${l.kind === 'straight' ? 'straight' : ''}`, x, y: l.n ? y + numSize * 1.05 : y, 'font-size': nameSize });
      t.textContent = l.name;
      g.append(t);
    }
    layer.append(g);
  }
}

// ---------------------------------------------------------------- weather

const pathBetween = (from, to, steps = 30) => {
  const span = ((to - from) % 1 + 1) % 1 || 1;
  const pts = [];
  for (let k = 0; k <= steps; k++) pts.push(sample(track, from + (span * k) / steps));
  return 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L');
};

/** Paint damp / wet sections and race-control rain spots onto the track. */
function drawWet() {
  if (!view?.wetLayer) return;
  view.wetLayer.replaceChildren();
  if (!weather) return;
  const w = view.w;
  for (const s of weather.state?.sections || []) {
    if (s.level === 'dry') continue;
    view.wetLayer.append(mk('path', { class: `track-wet ${s.level}`, d: pathBetween(s.from, s.to), 'stroke-width': w * 1.5 }));
  }
  // whole-track tint when race control declared a wet race but the model shows dry
  if (weather.rc.wet && !(weather.state?.sections || []).some((s) => s.level !== 'dry')) {
    view.wetLayer.append(mk('path', { class: 'track-wet damp', d: pathBetween(0, 0.999, 120), 'stroke-width': w * 1.5 }));
  }
  for (const at of weather.rc.spots) {
    view.wetLayer.append(mk('path', { class: 'track-wet rc', d: pathBetween(at - 0.02, at + 0.02, 12), 'stroke-width': w * 1.6 }));
  }
}

function drawWeather() {
  const box = $('wx');
  const st = weather?.state;
  const lw = model?.isLive ? model.liveWeather() : null;
  if (!st && !lw) { box.hidden = true; return; }
  box.hidden = false;
  const air = lw?.air ?? st?.air;
  const bars = (st?.steps || []).map((mm) => `<i class="${mm < 0.05 ? 'zero' : ''}" style="height:${Math.min(100, 10 + mm * 60)}%"></i>`).join('');
  const sections = st?.sections || [];
  const wet = sections.filter((s) => s.level === 'wet').length, damp = sections.filter((s) => s.level === 'damp').length;
  let cond;
  if (weather?.rc.wet) cond = '<span class="wx-pill wet">WET RACE · RC</span>';
  else if (wet) cond = `<span class="wx-pill wet">WET ${st.perSection ? `${wet}/${sections.length}` : ''}</span>`;
  else if (damp) cond = `<span class="wx-pill">DAMP ${st.perSection ? `${damp}/${sections.length}` : ''}</span>`;
  else cond = '<span class="wx-pill dry">DRY</span>';
  if (weather?.rc.spots.length) cond += '<span class="wx-pill wet">RC: SLIPPERY</span>';
  box.innerHTML = `
    <div class="wx-top"><span class="ico">${st?.icon || '🌡️'}</span><b>${air != null ? Math.round(air) + '°' : '—'}</b><span class="cond">${st?.text || ''}</span></div>
    <div class="wx-more">
      <div class="wx-row">${lw?.track != null ? `Track ${Math.round(lw.track)}° · ` : ''}Humidity ${lw?.humidity ?? st?.humidity ?? '—'}% · Wind ${Math.round(lw?.wind ?? st?.wind ?? 0)} km/h ${st?.windDir || ''}</div>
      ${bars ? `<div class="wx-bars" title="Rain, next 2 hours (worst part of the track)">${bars}</div><div class="wx-axis"><span>now</span><span>+1 h</span><span>+2 h</span></div>` : ''}
      ${st ? `<div class="wx-outlook">${st.outlook}</div>` : ''}
      <div class="wx-track">Track: ${cond}</div>
      <div class="wx-src">${lw ? 'Temps: Al Kamel timing · ' : ''}Rain: Open-Meteo model${st?.perSection ? `, ${sections.length} points round the lap` : ''}${model?.isLive && model.status().isFinished ? ' — today’s conditions, not the recorded session' : ''}</div>
    </div>`;
}

$('wx').onclick = () => {
  $('wx').classList.toggle('min');
  try { localStorage.setItem('racehub:wxmin', $('wx').classList.contains('min') ? '1' : ''); } catch { /* ignore */ }
};
try { if (localStorage.getItem('racehub:wxmin')) $('wx').classList.add('min'); } catch { /* ignore */ }

function onWeather({ detail: { prev, state } }) {
  if (!view) return; // map not built yet; setModel draws weather when it is
  drawWet();
  drawWeather();
  const wetSecs = state.sections.filter((s) => s.level !== 'dry');
  const where = () => {
    if (!state.perSection || wetSecs.length === state.sections.length) return 'across the whole lap';
    const names = [...new Set(wetSecs.map((s) => cornerAt(track, s.at)))].slice(0, 3);
    return `around ${names.join(', ')}`;
  };
  const rainingNow = state.sections.some((s) => s.now > 0);
  const wasRaining = prev?.sections.some((s) => s.now > 0);
  if (!prev) {
    if (wetSecs.length) wxToast('Wet track', `${state.text} — track ${wetSecs.some((s) => s.level === 'wet') ? 'wet' : 'damp'} ${where()}.`);
    return;
  }
  if (rainingNow && !wasRaining) wxToast('Rain', `Rain is falling ${where()}. Expect slower laps and tyre calls.`);
  else if (!rainingNow && wasRaining) wxToast('Rain stopped', 'The rain has stopped — the track will start drying.');
  else if (!rainingNow && /Rain in/.test(state.outlook) && !/Rain in/.test(prev.outlook)) wxToast('Rain on the way', `${state.outlook} at ${track.name}.`);
}

function wxToast(title, text) {
  toast({ kind: 'rain', title, text });
}

$('cornerBtn').onclick = () => {
  cornerMode = CORNER_MODES[(CORNER_MODES.indexOf(cornerMode) + 1) % CORNER_MODES.length];
  try { localStorage.setItem('racehub:corners', cornerMode); } catch { /* ignore */ }
  drawCornerLabels();
};

function mk(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function carEl(c) {
  let g = view.carEls.get(c.id);
  if (g) return g;
  // Marker: team colour fill, car number, ring in the class colour.
  const r = view.carR;
  g = mk('g', { class: 'car' });
  g.append(mk('circle', { class: 'sel-ring', r: r * 1.55, 'stroke-width': r * 0.22 }));
  g.append(mk('circle', { class: 'body', r, fill: c.teamColor, stroke: c.color, 'stroke-width': r * 0.34 }));
  const t = mk('text', { 'font-size': r * (String(c.num).length > 2 ? 0.82 : 1.05), fill: c.textColor });
  t.textContent = c.num;
  g.append(t);
  const title = mk('title', {});
  title.textContent = `#${c.num} ${c.make} · ${c.cls}`;
  g.append(title);
  g.addEventListener('click', () => openOnboard(c.id));
  view.carsLayer.append(g);
  view.carEls.set(c.id, g);
  return g;
}

function updateNote() {
  if (model.isLive) {
    const noFix = model.cars.filter((c) => c.anchorP == null).length;
    $('mapNote').textContent = `Al Kamel live timing · ${model.label()}${noFix ? ` · ${noFix} cars without position (pits / garage)` : ''}`;
  } else {
    $('mapNote').textContent = `${track.real ? 'Real track outline' : 'Approximate track shape (circuit not in open track data)'} · Simulated timing`;
  }
}

function drawMap() {
  const ids = new Set();
  for (const c of model.cars) {
    ids.add(c.id);
    const g = carEl(c);
    const hidden = model.isLive && c.anchorP == null;
    g.style.display = hidden ? 'none' : '';
    if (hidden) continue;
    const s = sample(track, c.p);
    const nx = -Math.sin(s.h), ny = Math.cos(s.h);
    const off = c.inPit ? view.w * 2.4 : c.lane * view.w * 0.9;
    g.setAttribute('transform', `translate(${(s.x + nx * off).toFixed(1)},${(s.y + ny * off).toFixed(1)})`);
    g.classList.toggle('pit', !!c.inPit);
    g.classList.toggle('sel', c.id === selected);
    const key = c.teamColor + c.color;
    if (g.dataset.k !== key) { // colours can arrive after the car (live class list)
      g.dataset.k = key;
      g.querySelector('.body').setAttribute('fill', c.teamColor);
      g.querySelector('.body').setAttribute('stroke', c.color);
      g.querySelector('text').setAttribute('fill', c.textColor);
    }
  }
  for (const [id, g] of view.carEls) if (!ids.has(id)) { g.remove(); view.carEls.delete(id); }
  const sel = view.carEls.get(selected);
  if (sel) view.carsLayer.append(sel); // keep selected car on top

  drawYellow();
}

// Caution zones: flashing yellow sections, whole-track amber for FCY / safety car, red for a red flag.
function drawYellow() {
  const zones = model.yellowZones();
  const key = zones.map((z) => `${z.kind}${z.from.toFixed(3)}${z.to.toFixed(3)}`).join();
  if (key === view.yellowKey) return;
  view.yellowKey = key;
  view.yellowLayer.replaceChildren();
  for (const z of zones) {
    const full = z.to - z.from >= 0.999;
    view.yellowLayer.append(mk('path', {
      class: `yz ${z.kind}`,
      d: full ? pathBetween(0, 0.999, 160) : pathBetween(z.from, z.to, 24),
      'stroke-width': view.w * (full ? 1.25 : 1.5),
    }));
  }
}

// ---------------------------------------------------------------- timing tower

function buildTabs() {
  const tabs = [['all', 'Overall'], ...model.classes().map(([c]) => [c, c])];
  if (!tabs.some(([k]) => k === towerFilter) && towerFilter !== 'champ') towerFilter = 'all';
  $('towerTabs').innerHTML = tabs.map(([k, l]) => `<button data-k="${esc(k)}" class="${k === towerFilter ? 'on' : ''}">${esc(l)}</button>`).join('')
    + `<button data-k="champ" class="champ ${towerFilter === 'champ' ? 'on' : ''}" title="Championship standings">🏆 Standings</button>`;
  $('towerTabs').onclick = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    towerFilter = k;
    buildTabs();
    champDrawn = false;
    drawTower();
  };
  $('towerList').onclick = (e) => {
    const row = e.target.closest('.t-row');
    if (row) openOnboard(row.dataset.id);
  };
}

// ---------------------------------------------------------------- championship standings

let standings = null; // { tables, page, fetchedAt } | 'loading' | 'none'
let champTable = 0;
let champDrawn = false;

function drawStandings() {
  const list = $('towerList');
  if (champDrawn) return;
  champDrawn = true;
  if (!standings) {
    standings = 'loading';
    const year = (ev.end || '').slice(0, 4) || new Date().getFullYear();
    loadStandings(series, +year).then((s) => { standings = s || 'none'; champDrawn = false; drawTower(); });
  }
  if (standings === 'loading') { list.innerHTML = '<div class="st-empty">Loading championship standings…</div>'; return; }
  if (standings === 'none') { list.innerHTML = '<div class="st-empty">No standings published for this season yet.</div>'; return; }

  const t = standings.tables[champTable] || standings.tables[0];
  // highlight entries that are in the session on screen (by surname / team)
  const here = new Set();
  for (const c of model.cars) {
    for (const d of c.drivers || []) { const last = d.split(' ').pop().toLowerCase(); if (last.length > 2) here.add(last); }
    if (c.team) here.add(c.team.toLowerCase());
  }
  const isHere = (name) => model.isLive && [...here].some((h) => name.toLowerCase().includes(h));
  const leader = t.rows[0]?.points || 0;
  const ago = Math.round((Date.now() - standings.fetchedAt) / 3600000);
  list.innerHTML = `
    <div class="st-head">
      <select id="champSel">${standings.tables.map((x, i) => `<option value="${i}" ${x === t ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <small>After the latest round · from Wikipedia (${esc(standings.page)}) · updated ${ago < 1 ? 'just now' : `${ago} h ago`}</small>
    </div>
    ${t.rows.map((r) => `
      <div class="st-row ${isHere(r.name) ? 'here' : ''}">
        <span class="t-pos">${r.pos}</span>
        <span class="st-name">${esc(r.name)}${r.team ? `<small>${esc(r.team)}</small>` : ''}</span>
        <span class="st-gap">${r.pos === 1 ? '' : `−${+(leader - r.points).toFixed(1)}`}</span>
        <span class="st-pts">${+r.points.toFixed(1)}</span>
      </div>`).join('')}`;
  $('champSel').onchange = (e) => { champTable = +e.target.value; champDrawn = false; drawStandings(); };
}

const prevPos = new Map();
function drawTower() {
  if (towerFilter === 'champ') { drawStandings(); return; }
  const ord = model.order();
  const list = towerFilter === 'all' ? ord : ord.filter((c) => c.cls === towerFilter);
  const lead = list[0];
  const rows = list.map((c, i) => {
    let gap = model.gapLabel(lead, c);
    if (gap === null) gap = towerFilter === 'all' ? `L${lapsOf(c)}` : 'Leader';
    const pos = i + 1;
    const key = `${towerFilter}:${c.id}`;
    const was = prevPos.get(key);
    const move = was ? (pos < was ? 'up' : pos > was ? 'down' : '') : '';
    prevPos.set(key, pos);
    const flag = c.state && c.state !== 'CLASSIFIED' ? 'OUT' : c.inPit ? 'PIT' : c.stopped || c.slowUntil > model.t ? '!' : '';
    return `<div class="t-row ${move} ${c.id === selected ? 'sel' : ''}" data-id="${esc(c.id)}">
      <span class="t-pos">${pos}</span>
      <span class="t-cls" style="background:${c.color}"></span>
      <span class="t-num chip" style="background:${c.teamColor};color:${c.textColor};box-shadow:inset 0 0 0 2px ${c.color}">${esc(c.num)}</span>
      <span class="t-car">${esc(c.make)}<small>${esc(c.drivers[0] || c.team || '')} · ${esc(c.cls)} · ${fmtLap(c.lastLap)}</small></span>
      <span class="t-gap">${gap}</span>
      <span class="t-flag">${flag}</span>
    </div>`;
  });
  $('towerList').innerHTML = rows.join('');
}

// ---------------------------------------------------------------- header clock / flag

function drawClock() {
  const { elapsed, remaining } = model.clockInfo();
  $('clock').textContent = fmtClock(elapsed);
  $('remaining').textContent = remaining;
  const f = model.flagInfo();
  $('flag').textContent = f.text;
  $('flag').className = `flag ${f.cls}`;
}

// ---------------------------------------------------------------- action popups

const KIND_COLOR = {
  overtake: '#2fbf71', battle: '#ff8a3d', incident: '#f2c21f', fcy: '#f2c21f', green: '#2fbf71',
  pit: '#7aa2ff', fastest: '#b26bff', lead: '#ff3b30', finish: '#ffffff', rc: '#8fb4ff', rain: '#3d8bff', yellow: '#ffd400',
};

function toast(e) {
  if (e.kind === 'rc' && weather) {
    const note = weather.readRaceControl(e.text, track.labels);
    if (note) { drawWet(); drawWeather(); setTimeout(() => wxToast('Track condition', note), 50); }
  }
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--kind', KIND_COLOR[e.kind] || '#f2c21f');
  el.innerHTML = `<b>${esc(e.title)}</b><div>${esc(e.text)}</div>`;
  const cars = (e.cars || []).map(carById).filter(Boolean);
  if (cars.length) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const car of cars) {
      const b = document.createElement('button');
      b.textContent = `▶ Onboard #${car.num}`;
      b.onclick = () => openOnboard(car.id);
      actions.append(b);
    }
    el.append(actions);
  }
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 9000);

  if ($('director').checked && cars.length && ['battle', 'incident', 'overtake', 'lead', 'rc'].includes(e.kind)) {
    openOnboard(cars[e.kind === 'battle' && cars[1] ? 1 : 0].id);
  }
}

// ---------------------------------------------------------------- onboard window

let ob = null; // { el, canvas, ctx, tab }

function openOnboard(id) {
  const c = carById(id);
  if (!c) return;
  selected = c.id;
  if (!ob) createOnboard();
  updateOnboardHeader();
  setObTab(ob.tab);
  drawTower();
}

function createOnboard() {
  const el = document.createElement('div');
  el.className = 'onboard';
  el.style.left = '16px';
  el.style.top = '16px';
  el.innerHTML = `
    <div class="ob-head">
      <span class="t-cls" id="obCls"></span>
      <span class="t-num" id="obNum"></span>
      <span class="ob-title" id="obTitle"></span>
      <button id="obPrev" title="Car ahead">▲</button>
      <button id="obNext" title="Car behind">▼</button>
      <button id="obClose" title="Close">✕</button>
    </div>
    <div class="ob-tabs">
      <button data-tab="onboard" class="on">Onboard</button>
      <button data-tab="stream">Live stream</button>
    </div>
    <div class="ob-body" id="obBody"></div>
    <div class="ob-stats">
      <div>Position<b id="obPos">—</b></div>
      <div>Speed<b id="obSpd">—</b></div>
      <div>Last lap<b id="obLast">—</b></div>
      <div>Best<b id="obBest">—</b></div>
    </div>`;
  $('mapWrap').append(el);
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 450;
  ob = { el, canvas, ctx: canvas.getContext('2d'), tab: 'onboard' };

  el.querySelector('#obClose').onclick = () => { el.remove(); ob = null; selected = null; drawTower(); };
  el.querySelector('#obPrev').onclick = () => stepCar(-1);
  el.querySelector('#obNext').onclick = () => stepCar(1);
  el.querySelectorAll('.ob-tabs button').forEach((b) => { b.onclick = () => setObTab(b.dataset.tab); });

  // drag by header
  const head = el.querySelector('.ob-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = el.getBoundingClientRect(), wrap = $('mapWrap').getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (m) => {
      el.style.left = `${Math.max(0, Math.min(wrap.width - r.width, m.clientX - wrap.left - dx))}px`;
      el.style.top = `${Math.max(0, Math.min(wrap.height - 40, m.clientY - wrap.top - dy))}px`;
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', () => head.removeEventListener('pointermove', move), { once: true });
  });
}

function stepCar(dir) {
  const ord = model.order();
  const i = ord.findIndex((c) => c.id === selected);
  const next = ord[(i + dir + ord.length) % ord.length];
  openOnboard(next.id);
}

function updateOnboardHeader() {
  const c = carById(selected);
  ob.el.querySelector('#obCls').style.background = c.color;
  ob.el.querySelector('#obNum').textContent = `#${c.num}`;
  ob.el.querySelector('#obTitle').innerHTML = `${esc(c.make)} <small>· ${esc(c.team)} · ${esc(c.drivers.join(' / '))}</small>`;
  if (ob.tab === 'stream') setObTab('stream');
}

const streamKey = (num) => `racehub:stream:${series.id}:${num}`;
const seriesStreamKey = () => `racehub:stream:${series.id}`;
const getStream = (num) => { try { return localStorage.getItem(streamKey(num)) || localStorage.getItem(seriesStreamKey()) || ''; } catch { return ''; } };

function embedFor(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return { iframe: `https://www.youtube.com/embed/${u.pathname.slice(1)}?autoplay=1&mute=1` };
    if (host.endsWith('youtube.com')) {
      const id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
      return { iframe: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` };
    }
    if (host.endsWith('twitch.tv')) return { iframe: `https://player.twitch.tv/?channel=${u.pathname.split('/')[1]}&parent=${location.hostname}&muted=true` };
    if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { video: url };
    return { iframe: url };
  } catch { return null; }
}

function setObTab(tab) {
  ob.tab = tab;
  ob.el.querySelectorAll('.ob-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = ob.el.querySelector('#obBody');
  body.replaceChildren();
  if (tab === 'onboard') { body.append(ob.canvas); return; }

  const c = carById(selected);
  const url = getStream(c.num);
  const emb = url && embedFor(url);
  if (emb) {
    const node = emb.video ? Object.assign(document.createElement('video'), { src: emb.video, autoplay: true, muted: true, controls: true })
      : Object.assign(document.createElement('iframe'), { src: emb.iframe, allow: 'autoplay; fullscreen', allowFullscreen: true });
    body.append(node);
    const edit = document.createElement('button');
    edit.textContent = 'Change';
    Object.assign(edit.style, { position: 'absolute', right: '6px', top: '6px', fontSize: '11px', background: '#000a', border: '1px solid #fff3', borderRadius: '4px', padding: '2px 6px' });
    edit.onclick = () => streamForm(body, c, url);
    body.append(edit);
  } else {
    streamForm(body, c, '');
  }
}

function streamForm(body, c, current) {
  body.replaceChildren();
  const f = document.createElement('form');
  f.className = 'ob-stream-form';
  f.innerHTML = `
    <p>Paste a stream link for <b>#${esc(c.num)}</b> — YouTube, Twitch, an .mp4, or any embeddable player URL.</p>
    <input name="url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(current)}">
    <label><input type="checkbox" name="all"> <span style="font-size:12px;color:var(--muted)">Use for every car in ${series.short}</span></label>
    <button>Save &amp; play</button>`;
  f.onsubmit = (e) => {
    e.preventDefault();
    const url = f.url.value.trim();
    try { localStorage.setItem(f.all.checked ? seriesStreamKey() : streamKey(c.num), url); } catch { /* ignore */ }
    setObTab('stream');
  };
  body.append(f);
}

// Pseudo-3D driver's-eye view built from the real track geometry ahead of the car.
function drawOnboard() {
  if (!ob) return;
  const c = carById(selected);
  if (!c) return;
  ob.el.querySelector('#obPos').textContent = `P${model.classPos(c)} ${c.cls}`;
  ob.el.querySelector('#obSpd').textContent = `${Math.round(model.speedKmh(c))}`;
  ob.el.querySelector('#obLast').textContent = fmtLap(c.lastLap);
  ob.el.querySelector('#obBest').textContent = fmtLap(c.bestLap);
  if (ob.tab !== 'onboard') return;

  const { ctx, canvas } = ob;
  const W = canvas.width, H = canvas.height;
  const horizon = H * 0.42;
  const F = W * 0.75;
  const camH = 1.1;
  const L = track.length;

  // sky + ground
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#5d86b8'); sky.addColorStop(1, '#bcd2e6');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);
  ctx.fillStyle = '#3f6b35'; ctx.fillRect(0, horizon, W, H - horizon);

  const P = sample(track, c.p);
  const A = sample(track, c.p + 8 / L);
  const h = Math.atan2(A.y - P.y, A.x - P.x);
  const cos = Math.cos(h), sin = Math.sin(h);
  const camLat = c.inPit ? 9 : c.lane * 5;
  const toCam = (x, y) => {
    const dx = x - P.x, dy = y - P.y;
    return { f: dx * cos + dy * sin, l: -dx * sin + dy * cos - camLat };
  };
  const proj = (f, l, up = 0) => ({ x: W / 2 + (l * F) / f, y: horizon + ((camH - up) * F) / f });
  const edge = (d, side, extra = 0) => {
    const s = sample(track, c.p + d / L);
    const nx = -Math.sin(s.h), ny = Math.cos(s.h);
    return toCam(s.x + nx * side * (6 + extra), s.y + ny * side * (6 + extra));
  };

  // road slices, far → near
  const STEP = 4, FAR = 320;
  const slices = [];
  for (let d = FAR; d >= 0; d -= STEP) {
    const s = sample(track, c.p + d / L);
    slices.push({ d, cam: toCam(s.x, s.y), ln: edge(d, -1), rn: edge(d, 1), corner: track.speed[s.i] < 0.8 });
  }
  for (let k = 0; k < slices.length - 1; k++) {
    const a = slices[k], b = slices[k + 1];
    if (a.cam.f < 0.5 || b.cam.f < 0.5) continue;
    const pa = [proj(a.ln.f, a.ln.l), proj(a.rn.f, a.rn.l)];
    const pb = [proj(Math.max(b.ln.f, 0.5), b.ln.l), proj(Math.max(b.rn.f, 0.5), b.rn.l)];
    const stripe = Math.floor((c.p * L + a.d) / 8) % 2 === 0;
    ctx.fillStyle = stripe ? '#3f6b35' : '#447239';
    ctx.fillRect(0, pa[0].y, W, pb[0].y - pa[0].y + 1);
    ctx.fillStyle = stripe ? '#4a4d52' : '#46494e';
    quad(ctx, pa[0], pa[1], pb[1], pb[0]);
    if (a.corner) {
      for (const side of [-1, 1]) {
        const aa = edge(a.d, side, 1.2), bb = edge(b.d, side, 1.2);
        ctx.fillStyle = stripe ? '#d33' : '#eee';
        const e1 = side < 0 ? pa[0] : pa[1], e2 = side < 0 ? pb[0] : pb[1];
        quad(ctx, e1, proj(aa.f, aa.l), proj(Math.max(bb.f, 0.5), bb.l), e2);
      }
    }
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(pa[0].x, pa[0].y); ctx.lineTo(pb[0].x, pb[0].y); ctx.moveTo(pa[1].x, pa[1].y); ctx.lineTo(pb[1].x, pb[1].y); ctx.stroke();
  }

  // other cars ahead
  const ahead = [];
  for (const o of model.cars) {
    if (o.id === c.id || o.inPit || (model.isLive && o.anchorP == null)) continue;
    const d = ((((o.p - c.p) % 1) + 1) % 1) * L;
    if (d < 4 || d > 260) continue;
    const s = sample(track, o.p);
    const nx = -Math.sin(s.h), ny = Math.cos(s.h);
    const cam = toCam(s.x + nx * o.lane * 5, s.y + ny * o.lane * 5);
    if (cam.f > 1) ahead.push({ o, cam });
  }
  ahead.sort((a, b) => b.cam.f - a.cam.f);
  for (const { o, cam } of ahead) {
    const p0 = proj(cam.f, cam.l - 1, 0), p1 = proj(cam.f, cam.l + 1, 1.15);
    const w = p1.x - p0.x, hgt = p0.y - p1.y;
    ctx.fillStyle = o.teamColor;
    ctx.fillRect(p0.x, p1.y, w, hgt);
    ctx.fillStyle = '#111';
    ctx.fillRect(p0.x + w * 0.1, p1.y + hgt * 0.15, w * 0.8, hgt * 0.3);
    ctx.fillStyle = o.color; // class colour stripe, like the map ring
    ctx.fillRect(p0.x, p1.y + hgt * 0.5, w, Math.max(2, hgt * 0.1));
    if (w > 18) {
      ctx.fillStyle = o.textColor;
      ctx.font = `700 ${Math.round(hgt * 0.35)}px "Barlow Condensed", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(o.num, p0.x + w / 2, p1.y + hgt * 0.85);
    }
  }

  // rain: gloomier light, streaks on the visor, a little spray from cars ahead
  const wet = weather?.levelAt(c.p) || 'dry';
  if (wet !== 'dry') {
    ctx.fillStyle = wet === 'wet' ? 'rgba(30,38,50,.38)' : 'rgba(30,38,50,.2)';
    ctx.fillRect(0, 0, W, H);
    const raining = weather.state?.sections.some((s) => s.now > 0) || wet === 'wet';
    if (raining) {
      const t = performance.now() / 1000;
      ctx.strokeStyle = 'rgba(200,215,235,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const drops = wet === 'wet' ? 90 : 35;
      for (let i = 0; i < drops; i++) {
        const x = (i * 97.3 + t * 140 * (1 + (i % 3))) % W;
        const y = (i * 53.7 + t * 520 * (1 + (i % 2))) % (H * 0.8);
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14);
      }
      ctx.stroke();
    }
    for (const { cam } of ahead) {
      if (cam.f > 120) continue;
      const p0 = proj(cam.f, cam.l, 0);
      const r = (F / cam.f) * 1.6;
      const g = ctx.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, r);
      g.addColorStop(0, 'rgba(210,220,235,.45)'); g.addColorStop(1, 'rgba(210,220,235,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p0.x - r, p0.y - r, r * 2, r * 2);
    }
  }

  // cockpit + HUD
  ctx.fillStyle = '#0d0f13';
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(0, H * 0.86); ctx.quadraticCurveTo(W / 2, H * 0.74, W, H * 0.86); ctx.lineTo(W, H); ctx.fill();
  ctx.fillStyle = c.color; ctx.fillRect(W * 0.38, H * 0.8, W * 0.24, 3);
  const kmh = model.speedKmh(c);
  const gear = c.inPit ? 1 : Math.min(6, Math.max(1, Math.ceil(kmh / 48)));
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = '700 42px "Barlow Condensed", sans-serif';
  ctx.fillText(Math.round(kmh), W / 2 - 50, H - 22);
  ctx.font = '700 46px "Barlow Condensed", sans-serif';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(gear, W / 2 + 50, H - 20);
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillStyle = '#9aa3b2';
  ctx.fillText('KM/H', W / 2 - 50, H - 8);
  ctx.fillText('GEAR', W / 2 + 50, H - 8);
  const rpm = ((kmh % 48) / 48) * 0.7 + 0.3;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i / 10 < rpm ? (i < 4 ? '#2fbf71' : i < 8 ? '#ff3b30' : '#5aa0ff') : '#222';
    ctx.fillRect(W / 2 - 75 + i * 15, H * 0.77, 11, 5);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.font = '700 15px "Barlow Condensed", sans-serif';
  const lapNo = c.currentLap ?? c.lap + 1;
  ctx.fillText(`#${c.num} · LAP ${lapNo}${c.inPit ? ' · IN PIT' : ''}`, 12, 22);
  if (wet !== 'dry') {
    ctx.fillStyle = '#6fb3ff';
    ctx.fillText(wet === 'wet' ? 'WET' : 'DAMP', 12, 40);
  }
  // next corner, like a TV graphic
  const nc = nextCorner(track.labels, c.p, L);
  if (nc && !c.inPit) {
    const txt = `${cornerText(nc).toUpperCase()}  ${Math.round(nc.dist)} m`;
    ctx.font = '700 17px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(txt).width + 22;
    ctx.fillStyle = 'rgba(11,13,18,.72)';
    ctx.fillRect(W / 2 - tw / 2, 8, tw, 26);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(W / 2 - tw / 2, 8, 3, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, W / 2, 27);
  }
  ctx.font = '700 15px "Barlow Condensed", sans-serif';
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath(); ctx.arc(W - 18, 18, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
  ctx.fillText(model.isLive ? 'LIVE TRACK POS' : 'ONBOARD', W - 28, 23);
}

function quad(ctx, a, b, c2, d) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
}

// ---------------------------------------------------------------- main loop

function frame(now) {
  // Cap so a backgrounded tab doesn't jump minutes ahead when it wakes up.
  const dt = Math.min(1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (model) {
    model.advance(model.isLive ? dt : dt * speedX);
    drawMap();
    drawOnboard();
    if (now - lastTower > 300) {
      drawTower(); drawClock();
      if (model.isLive) updateNote();
      if (model.isLive && now - (frame.lastWx || 0) > 5000) { drawWeather(); frame.lastWx = now; }
      lastTower = now;
    }
  }
  requestAnimationFrame(frame);
}

$('speedCtl').onclick = (e) => {
  const x = +e.target.dataset.x;
  if (!x) return;
  speedX = x;
  $('speedCtl').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.x === x));
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function init() {
  header();
  buildSourcePicker();
  weather = new TrackWeather({ circuit: ev.circuit, location: ev.location });
  weather.addEventListener('update', onWeather);
  weather.start();
  await useSimulation();
  requestAnimationFrame(frame);
  // For Al Kamel series, look for a live session and switch to it automatically.
  if (feed) useLive(null, { auto: true });
}

init();
