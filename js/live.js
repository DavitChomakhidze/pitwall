// LiveRace: turns the Al Kamel collections into the same model the race view
// uses for the simulation (cars with a lap-progress `p`, order, gaps, flags)
// and emits action events from real changes in the timing data.

import { buildTrack, cornerAt } from './tracks.js';
import { cornerLabels } from './corners.js';
import { teamColour, textOn } from './liveries.js';

const titleCase = (s) => (s || '').toLowerCase().replace(/(^|[\s\-.(/])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Vehicle names: keep short tokens and model codes upper-case (BMW, AMG, GT3, ARX-06).
const vehicleCase = (s) => (s || '').split(' ').map((w) => w.split('-').map((p) => (
  p.length <= 3 || /\d/.test(p) ? p.toUpperCase() : titleCase(p)
)).join('-')).join(' ');

const FLAGS = {
  GF: { text: 'GREEN', cls: '' },
  YF: { text: 'YELLOW', cls: 'yellow' },
  FCY: { text: 'FCY', cls: 'sc' },
  CY: { text: 'CODE 60', cls: 'sc' },
  SC: { text: 'SAFETY CAR', cls: 'sc' },
  VSC: { text: 'VSC', cls: 'sc' },
  RF: { text: 'RED FLAG', cls: 'red' },
  CH: { text: 'FINISH', cls: '' },
};

export class LiveRace {
  constructor(client, series) {
    this.client = client;
    this.series = series;
    this.isLive = true;
    this.listeners = [];
    this.cars = [];
    this.byNum = new Map();
    this.t = 0;
    this.yellow = null;
    this.track = null;
    this.primed = false; // first full snapshot seen — only diffs after this raise events
    this.battleSince = new Map();
    this.battleCooldown = new Map();
    this.seenRc = 0;
    client.addEventListener('change', (e) => this.onChange(e.detail.collection));
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { if (this.primed) this.listeners.forEach((fn) => fn({ ...ev, t: this.t })); }

  /** True once there's enough data to draw the race. */
  get ready() { return !!(this.track && this.cars.length); }

  info() { return this.client.one('session_info')?.info || {}; }
  status() { return this.client.one('session_status')?.status || {}; }

  classes() {
    const cls = this.client.one('session_classes')?.classes?.classes || {};
    return Object.values(cls).sort((a, b) => a.order - b.order).map((c) => [c.name, this.classColor(c.name)]);
  }

  classColor(name) {
    const mine = this.series.classes.find(([n]) => norm(n) === norm(name));
    if (mine) return mine[1];
    const ak = this.client.one('session_classes')?.classes?.classes?.[name];
    return ak?.background || '#9aa3b2';
  }

  // ------------------------------------------------------------ data → model

  onChange(collection) {
    if (collection === 'session_circuit_config' || collection === 'track_info') this.buildTrack();
    if (['session_entry', 'standings', 'session_classes'].includes(collection)) this.syncCars();
    if (collection === 'session_positioning') this.syncPositions();
    if (collection === 'session_status') this.checkFlag();
    if (collection === 'race_control') this.checkRaceControl();
    if (collection === 'session_circuit_status') this.checkSections();
    if (!this.primed && this.ready && this.client.one('standings') && this.client.one('session_status')) {
      // let the initial burst settle before announcing anything
      clearTimeout(this.primeTimer);
      this.primeTimer = setTimeout(() => { this.primed = true; }, 2500);
    }
  }

  buildTrack() {
    const cc = this.client.one('session_circuit_config')?.circuitConfig;
    if (!cc?.centerPath) return;
    const v = cc.centerPath.split(';').filter((x) => x !== '').map(Number);
    const W = cc.width || 2000, H = cc.height || 2000;
    const px = [];
    for (let i = 0; i + 1 < v.length; i += 2) px.push({ x: v[i] * W, y: v[i + 1] * H });
    let lenPx = 0;
    const cum = [0];
    for (let i = 1; i < px.length; i++) cum.push(lenPx += Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y));
    // Al Kamel addresses track sections / sectors by centre-path point index
    const idxFrac = (i) => cum[Math.max(0, Math.min(cum.length - 1, i))] / lenPx;
    const starts = (cc.sections || '').split(';').filter((x, k) => k % 2 === 0 && x !== '').map(Number);
    this.sections = starts.map((s, k) => ({ from: idxFrac(s), to: k + 1 < starts.length ? idxFrac(starts[k + 1]) : 1 }));
    const sv = (cc.sectors || '').split(';');
    this.sectors = [];
    for (let k = 0; k + 3 < sv.length; k += 4) this.sectors.push({ n: +sv[k], from: idxFrac(+sv[k + 1]), to: idxFrac(+sv[k + 2]) });
    const ti = this.client.one('track_info')?.track;
    // Lengths come in the session's unit; IMSA runs imperial (Road Atlanta = 2.54 mi).
    const unit = this.client.one('session_info')?.info?.unitOfMeasure || (this.client.feed === 'imsa' ? 'IMPERIAL' : 'METRIC');
    const km = (ti?.length || 5) * (unit === 'IMPERIAL' ? 1.609344 : 1);
    const scale = (km * 1000) / lenPx;
    this.toM = (x, y) => ({ x: x * W * scale, y: y * H * scale });
    this.track = buildTrack(px.map((p) => ({ x: p.x * scale, y: p.y * scale })), titleCase(ti?.name || 'Circuit'), true);
    this.track.source = 'alkamel';
    this.track.labels = cornerLabels(this.track, [ti?.name, ti?.shortName], ti?.numberOfTurns);
    const n = this.track.speed.length;
    this.K = this.track.speed.reduce((a, s) => a + 1 / s, 0) / n;
    // positions computed against an older track are meaningless now
    for (const c of this.cars) c.anchorP = null;
    this.syncPositions();
  }

  syncCars() {
    const entries = this.client.one('session_entry')?.entry || {};
    const rows = this.client.one('standings')?.standings?.standings || {};
    const seen = new Set();
    for (const row of Object.values(rows)) {
      const d = (row.data || '').split(';');
      const num = (d[1] || '').trim();
      if (!num) continue;
      seen.add(num);
      let c = this.byNum.get(num);
      const e = entries[num] || {};
      if (!c) {
        c = {
          id: num, num, p: 0, lap: 0, lane: ((parseInt(num, 10) * 37) % 100) / 100 - 0.5,
          anchorP: null, anchorT: 0, pred: 0, inPit: false, stopped: false, slowUntil: 0, lastPitT: -1e9,
        };
        this.byNum.set(num, c);
        this.cars.push(c);
      }
      const prev = { pos: c.pos, pic: c.pic, trackStatus: c.trackStatus, state: c.state, best: c.bestLap, laps: c.laps };
      c.cls = row.class || e.class || '';
      c.color = this.classColor(c.cls);
      c.make = vehicleCase(e.vehicle || '') || 'Car';
      c.team = e.team || '';
      c.drivers = Object.values(e.drivers || {}).map((x) => titleCase(x.name || `${x.firstname} ${x.lastname}`)).filter(Boolean);
      if (!c.drivers.length) c.drivers = [titleCase(e.name || '')];
      c.teamColor = teamColour(c.team, c.make);
      c.textColor = textOn(c.teamColor);
      c.pos = +d[0];
      c.state = d[2];
      c.pic = +d[3];
      c.laps = +d[4];
      c.pits = +d[5];
      c.lapStartTime = +d[7];
      c.trackStatus = d[8];
      c.currentLap = +d[9];
      c.lastLap = row.lastLapTime ? row.lastLapTime / 1000 : null;
      c.bestLap = row.bestLapTime ? row.bestLapTime / 1000 : null;
      c.elapsedMs = row.elapsedTime || 0;
      c.finished = !!row.isCheckered;
      c.inPit = c.trackStatus === 'BOX' || c.state !== 'CLASSIFIED';
      c.stopped = c.trackStatus === 'STOPPED';
      c.slowUntil = c.stopped ? Infinity : 0;
      c.pace = this.paceFor(c);
      this.carEvents(c, prev);
    }
    // cars no longer in standings
    if (seen.size) {
      this.cars = this.cars.filter((c) => seen.has(c.num));
      for (const k of [...this.byNum.keys()]) if (!seen.has(k)) this.byNum.delete(k);
    }
    this.cars.sort((a, b) => a.pos - b.pos);
    this.classEvents();
  }

  paceFor(c) {
    const best = c.bestLap;
    if (best && c.lastLap) return Math.min(Math.max(c.lastLap, best * 0.98), best * 1.3);
    if (best) return best * 1.04;
    if (this.track) return (this.track.length / 1000 / 150) * 3600;
    return 100;
  }

  /** Map Al Kamel's normalised x/y to a lap fraction on our resampled track. */
  syncPositions() {
    if (!this.track) return;
    const pos = this.client.one('session_positioning')?.data;
    if (!pos) return;
    const now = performance.now();
    const parse = (s) => {
      const out = new Map();
      const v = (s || '').split(';');
      for (let i = 0; i + 9 < v.length; i += 10) out.set(v[i + 8].trim(), { x: +v[i], y: +v[i + 1], pos: +v[i + 6], pic: +v[i + 7] });
      return out;
    };
    const onTrack = parse(pos.data);
    const inPit = parse(pos.pit);
    const stopped = parse(pos.stopped);

    for (const c of this.cars) {
      if (inPit.has(c.num)) { c.inPit = true; continue; }
      const q = onTrack.get(c.num) || stopped.get(c.num);
      if (!q) continue;
      if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) { c.inPit = true; continue; }
      const m = this.toM(q.x, q.y);
      const { idx, dist } = this.nearest(m, c.anchorP);
      if (dist > 60) continue; // off the racing line (paddock, run-off); keep last good fix
      const frac = idx / this.track.pts.length;
      let p;
      if (c.anchorP == null) {
        p = Math.max(0, (c.currentLap || c.laps + 1) - 1) + frac;
      } else {
        const ref = c.pred;
        const base = Math.floor(ref);
        p = [base - 1 + frac, base + frac, base + 1 + frac].reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
      }
      if (c.anchorP == null) { c.p = p; c.pred = p; c.rateAdj = 1; c.predSinceFix = 0; }
      // Learn how fast the car really is going (yellow flags, traffic, slow laps)
      // by comparing the distance it covered with what we predicted.
      const gapS = (now - c.anchorT) / 1000;
      if (c.predSinceFix > 0.002 && gapS > 0.3 && gapS < 10) {
        const ratio = Math.min(3, Math.max(0.1, (p - c.anchorP) / c.predSinceFix));
        c.rateAdj = Math.min(1.8, Math.max(0.15, c.rateAdj * Math.sqrt(ratio)));
      }
      c.predSinceFix = 0;
      c.anchorP = p;
      c.anchorT = now;
      c.pred = p;
      if (stopped.has(c.num)) c.stopped = true;
    }
  }

  nearest(m, hintP) {
    const pts = this.track.pts;
    const n = pts.length;
    const scan = (from, to) => {
      let best = -1, bd = Infinity;
      for (let k = from; k <= to; k++) {
        const i = ((k % n) + n) % n;
        const d = (pts[i].x - m.x) ** 2 + (pts[i].y - m.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return { idx: best, dist: Math.sqrt(bd) };
    };
    if (hintP != null) {
      // search near where we expect the car first, so crossovers (Suzuka) don't confuse it
      const c = Math.floor((((hintP % 1) + 1) % 1) * n);
      const w = Math.ceil(n * 0.12);
      const local = scan(c - Math.floor(w / 3), c + w);
      if (local.dist < 40) return local;
    }
    return scan(0, n - 1);
  }

  // ------------------------------------------------------------ per-frame

  advance(dt) {
    this.t += dt;
    if (!this.track) return;
    const now = performance.now();
    const n = this.track.speed.length;
    const running = this.status().isSessionRunning && !this.status().isFinished;
    for (const c of this.cars) {
      if (c.anchorP == null) continue;
      const stale = (now - c.anchorT) / 1000 > 8;
      if (running && !c.inPit && !c.stopped && !c.finished && !stale) {
        const i = Math.floor((((c.pred % 1) + 1) % 1) * n);
        const step = (dt * this.track.speed[i] * this.K * (c.rateAdj || 1)) / c.pace;
        c.pred += step;
        c.predSinceFix += step;
      }
      // Ease the drawn position toward the prediction to hide update jumps. If the
      // prediction ran ahead, hold the dot until it catches up rather than reversing.
      const diff = c.pred - c.p;
      if (diff > 0.2 || diff < -0.03) c.p = c.pred;
      else if (diff > 0) c.p += diff * Math.min(1, dt * 5);
    }
  }

  // ------------------------------------------------------------ interface used by race.js

  order() { return [...this.cars].sort((a, b) => a.pos - b.pos); }
  classPos(c) { return c.pic || 0; }

  gapSec(a, b) {
    if (a.laps === b.laps && a.lapStartTime && b.lapStartTime) return Math.max(0, (b.lapStartTime - a.lapStartTime) / 1000);
    return Infinity;
  }

  gapLabel(lead, c) {
    if (!this.isRaceSession) {
      // practice / qualifying: rank by best lap, show the deficit to the fastest
      if (c === lead) return c.bestLap ? fmtLap(c.bestLap) : null;
      return c.bestLap && lead.bestLap ? `+${(c.bestLap - lead.bestLap).toFixed(3)}` : 'no time';
    }
    if (c === lead) return null;
    const laps = lead.laps - c.laps;
    if (laps >= 1) return `+${laps} L`;
    const g = this.gapSec(lead, c);
    return Number.isFinite(g) ? `+${g.toFixed(1)}` : '';
  }

  speedKmh(c) {
    if (c.inPit) return 60;
    if (c.stopped || c.finished) return 0;
    const n = this.track.speed.length;
    const i = Math.floor((((c.p % 1) + 1) % 1) * n);
    return ((this.track.speed[i] * this.K * (c.rateAdj || 1)) / c.pace) * this.track.length * 3.6;
  }

  flagInfo() {
    const s = this.status();
    if (s.isFinished) return FLAGS.CH;
    if (!s.isSessionRunning) return { text: 'NOT STARTED', cls: 'yellow' };
    if (s.currentFlag === 'GF' && this.yellowZones().some((z) => z.kind === 'yellow' || z.kind === 'double')) return { text: 'LOCAL YELLOW', cls: 'yellow' };
    return FLAGS[s.currentFlag] || { text: s.currentFlag || '—', cls: '' };
  }

  /** Track sections under caution, from Al Kamel's section lights, race control and the flag. */
  yellowZones() {
    const z = [];
    const s = this.status();
    if (!s.isFinished && ['FCY', 'SC', 'VSC', 'CY'].includes(s.currentFlag)) z.push({ from: 0, to: 1, kind: 'fcy' });
    if (!s.isFinished && s.currentFlag === 'RF') z.push({ from: 0, to: 1, kind: 'red' });
    (this.sectionStatus || []).forEach((on, k) => { if (on && this.sections?.[k]) z.push({ ...this.sections[k], kind: 'yellow' }); });
    const now = performance.now();
    this.rcYellows = (this.rcYellows || []).filter((y) => y.until > now);
    for (const y of this.rcYellows) z.push({ from: y.from, to: y.to, kind: y.kind });
    return z;
  }

  checkSections() {
    const raw = this.client.one('session_circuit_status')?.circuitStatus?.sectionsStatus || '';
    const next = raw.split(';').slice(0, -1).map((x) => x === 'true');
    const prev = this.sectionStatus || [];
    this.sectionStatus = next;
    if (!this.track) return;
    next.forEach((on, k) => {
      if (on && !prev[k] && this.sections?.[k]) {
        const mid = (this.sections[k].from + this.sections[k].to) / 2;
        this.emit({ kind: 'yellow', title: 'Yellow flag', text: `Local yellow at ${cornerAt(this.track, mid)}.` });
      }
    });
  }

  /** "DOUBLE YELLOW TURN 5", "YELLOW FLAG SECTOR 2" … → temporary zone on the map. */
  rcYellow(message) {
    const m = (message || '').toUpperCase();
    if (!/YELLOW/.test(m) || /FULL COURSE|FCY|CODE 60/.test(m)) return;
    const kind = /DOUBLE/.test(m) ? 'double' : 'yellow';
    const until = performance.now() + 3 * 60 * 1000; // messages don't say when it's lifted
    const turns = [...m.matchAll(/\b(?:TURN|T)\s*(\d+)/g)].map((x) => +x[1]);
    for (const n of turns) {
      const at = this.track?.labels?.find((l) => l.n === n)?.at;
      if (at != null) this.rcYellows = [...(this.rcYellows || []), { from: at - 0.02, to: at + 0.02, kind, until }];
    }
    const sec = m.match(/SECTOR\s*(\d+)/);
    const sector = sec && this.sectors?.find((s) => s.n === +sec[1]);
    if (sector) this.rcYellows = [...(this.rcYellows || []), { from: sector.from, to: sector.to, kind, until }];
  }

  clockInfo() {
    const s = this.status();
    const leader = this.cars[0];
    let elapsed = 0;
    if (s.isFinished && leader) elapsed = leader.elapsedMs / 1000;
    else if (s.startTime) elapsed = Date.now() / 1000 - s.startTime - (s.stoppedSeconds || 0);
    let remaining;
    if (s.isFinished) remaining = 'Chequered flag';
    else if (!s.isSessionRunning) remaining = 'Waiting for start';
    else if (/LAPS/.test(s.finalType || '') && s.finalLaps && !/TIME/.test(s.finalType)) remaining = `${Math.max(0, s.finalLaps - (s.elapsedLaps || 0))} laps to go`;
    else if (s.finalTime) remaining = `${fmtHMS(s.finalTime - elapsed)} to go`;
    return { elapsed, remaining: remaining || '' };
  }

  /** session_info is only published for the feed's current session, so fall back to the sessions list. */
  sessionMeta() {
    const i = this.info();
    const cur = this.client.one('session_info');
    if (cur && (!this.client.sessionId || cur.session?.$value === this.client.sessionId)) {
      return { champ: i.champName, event: i.eventName, name: titleCase(i.name || ''), type: i.type };
    }
    const s = this.client.sessionList().find((x) => x.id === this.client.sessionId);
    return s ? { champ: s.champ, event: s.event, name: s.name, type: /race/i.test(s.name) ? 'RACE' : 'OTHER' } : {};
  }

  get isRaceSession() { return (this.sessionMeta().type || 'RACE') === 'RACE'; }

  /** Timing-feed weather station: { air, track, humidity, wind } or null. */
  liveWeather() {
    const w = this.client.one('weather')?.weather;
    return w ? { air: w.ambientTemperature, track: w.trackTemperature, humidity: w.humidity, wind: w.windSpeed } : null;
  }

  label() {
    const m = this.sessionMeta();
    return [m.champ, m.event, m.name].filter(Boolean).join(' · ');
  }

  // ------------------------------------------------------------ events from real changes

  carEvents(c, prev) {
    if (prev.trackStatus === undefined) return;
    const front = c.pic && c.pic <= 3;
    if (prev.trackStatus !== 'BOX' && c.trackStatus === 'BOX') {
      c.lastPitT = this.t;
      if (front) this.emit({ kind: 'pit', title: 'Pit stop', text: `#${c.num} ${c.make} (P${c.pic} ${c.cls}) is in the pits.`, cars: [c.id] });
    }
    if (prev.trackStatus === 'BOX' && c.trackStatus !== 'BOX') {
      c.lastPitT = this.t;
      if (front) this.emit({ kind: 'pit', title: 'Pit exit', text: `#${c.num} ${c.make} rejoins.`, cars: [c.id] });
    }
    if (prev.trackStatus !== 'STOPPED' && c.trackStatus === 'STOPPED') {
      const where = this.track && c.anchorP != null ? ` at ${cornerAt(this.track, c.p)}` : ' on track';
      this.emit({ kind: 'incident', title: 'Car stopped', text: `#${c.num} ${c.make} has stopped${where}.`, cars: [c.id] });
    }
    if (prev.state === 'CLASSIFIED' && c.state === 'RETIRED') {
      this.emit({ kind: 'incident', title: 'Retirement', text: `#${c.num} ${c.make} (${c.cls}) retires.`, cars: [c.id] });
    }
    if (c.bestLap && prev.best && c.bestLap < prev.best) {
      const classBest = Math.min(...this.cars.filter((o) => o.cls === c.cls && o !== c && o.bestLap).map((o) => o.bestLap), Infinity);
      if (c.bestLap < classBest) this.emit({ kind: 'fastest', title: `Fastest lap · ${c.cls}`, text: `#${c.num} ${c.make} — ${fmtLap(c.bestLap)}`, cars: [c.id] });
    }
  }

  classEvents() {
    const recentPit = (x) => x.inPit || this.t - x.lastPitT < 120;
    // overall lead
    const leader = this.cars[0];
    if (leader && this.prevLeader && this.prevLeader !== leader.num) {
      const old = this.byNum.get(this.prevLeader);
      if (old && !recentPit(old) && !recentPit(leader)) this.emit({ kind: 'lead', title: 'New race leader', text: `#${leader.num} ${leader.make} takes the lead from #${old.num}.`, cars: [leader.id, old.id] });
    }
    this.prevLeader = leader?.num;

    const byClass = {};
    for (const c of this.cars) (byClass[c.cls] ||= []).push(c);
    const prevPic = this.prevPic || new Map();
    for (const [cls, list] of Object.entries(byClass)) {
      list.sort((a, b) => a.pic - b.pic);
      list.forEach((c, i) => {
        const was = prevPic.get(c.num);
        if (!was || c.pic >= was || c.pic > 6) return;
        const passed = list[i + 1];
        if (!passed || prevPic.get(passed.num) !== c.pic || recentPit(c) || recentPit(passed)) return;
        this.emit({ kind: 'overtake', title: `Overtake · ${cls}`, text: `#${c.num} ${c.make} passes #${passed.num} for P${c.pic}.`, cars: [c.id, passed.id] });
      });
      for (let i = 0; i < Math.min(list.length - 1, 5); i++) {
        const a = list[i], b = list[i + 1];
        const key = `${a.num}-${b.num}`;
        const close = !recentPit(a) && !recentPit(b) && this.gapSec(a, b) < 1;
        if (!close) { this.battleSince.delete(key); continue; }
        if (!this.battleSince.has(key)) this.battleSince.set(key, b.laps);
        if (b.laps - this.battleSince.get(key) >= 2 && this.t > (this.battleCooldown.get(key) || 0)) {
          this.battleCooldown.set(key, this.t + 900);
          this.emit({ kind: 'battle', title: `Battle for P${a.pic} · ${cls}`, text: `#${b.num} ${b.make} is within a second of #${a.num} ${a.make}.`, cars: [a.id, b.id] });
        }
      }
    }
    this.prevPic = new Map(this.cars.map((c) => [c.num, c.pic]));
  }

  checkFlag() {
    const s = this.status();
    const flag = s.isFinished ? 'CH' : s.currentFlag;
    if (this.prevFlag && flag !== this.prevFlag) {
      const f = FLAGS[flag] || { text: flag };
      const kind = flag === 'GF' ? 'green' : flag === 'CH' ? 'finish' : ['FCY', 'SC', 'VSC', 'CY', 'RF'].includes(flag) ? 'fcy' : 'incident';
      const winner = this.cars[0];
      this.emit({
        kind,
        title: flag === 'CH' ? 'Chequered flag' : `${f.text} flag`.replace('FLAG flag', 'flag'),
        text: flag === 'CH' && winner ? `#${winner.num} ${winner.make} wins!` : flag === 'GF' ? 'Racing resumes.' : 'Race control has changed the track status.',
        cars: flag === 'CH' && winner ? [winner.id] : undefined,
      });
    }
    this.prevFlag = flag;
  }

  checkRaceControl() {
    const log = this.client.one('race_control')?.raceControlMessages?.log || {};
    const msgs = Object.values(log).sort((a, b) => a.date - b.date);
    const newest = msgs.length ? msgs[msgs.length - 1].date : 0;
    if (this.primed) {
      for (const m of msgs) {
        if (m.date <= this.seenRc) continue;
        const cars = [...(m.message || '').matchAll(/\bCARS?\s+((?:#?\d+(?:\s*(?:,|AND|&)\s*)?)+)/gi)]
          .flatMap((x) => x[1].match(/\d+/g) || [])
          .filter((n) => this.byNum.has(n));
        this.rcYellow(m.message);
        this.emit({ kind: 'rc', title: 'Race control', text: titleCaseSentence(m.message), cars: cars.length ? cars : undefined });
      }
    }
    this.seenRc = Math.max(this.seenRc, newest);
  }
}

function titleCaseSentence(s) {
  const t = (s || '').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fmtHMS(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

function fmtLap(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}
