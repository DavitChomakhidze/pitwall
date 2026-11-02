// Super Taikyu live timing (supertaikyu.live). Plain JSON files through
// server.js, translated into the same documents Al Kamel publishes so LiveRace
// handles standings, gaps and events. The feed has no x/y positions, flags or
// session names: dots are estimated from each car's last timing-point crossing.

import { LiveRace } from './live.js';
import { isFreshTaikyu } from './sources.js';

const PALETTE = ['#e8443a', '#f2b61f', '#3d7dff', '#a55cf0', '#2fbf71', '#ff8a3d', '#1fc4c4', '#c0c6cf', '#c27a3a', '#ff5fa2'];

export class TaikyuClient extends EventTarget {
  constructor({ base = '' } = {}) {
    super();
    this.base = base;
    this.feed = 'taikyu';
    this.sessionId = null;
    this.docs = new Map();
    this.feedInfo = { running: false };
    this.closed = false;
  }

  one(name) { return this.docs.get(name) || null; }
  sessionList() { return []; }

  connect() { this.tick(); }
  close() { this.closed = true; clearTimeout(this.timer); }

  async file(name) {
    const r = await fetch(`${this.base}/api/taikyu?file=${name}`);
    if (!r.ok) throw new Error(`taikyu ${name} HTTP ${r.status}`);
    return r.json();
  }

  async tick() {
    let running = false;
    try {
      const info = await this.file('updateinfo');
      running = isFreshTaikyu(info.LiveMoniUpdateTime);
      this.feedInfo = { running };
      if (!this.master || (info.MasterUpdateTime && info.MasterUpdateTime !== this.masterStamp)) {
        this.master = await this.file('master');
        this.masterStamp = info.MasterUpdateTime;
      }
      if (info.LiveMoniUpdateTime !== this.liveStamp) {
        this.liveStamp = info.LiveMoniUpdateTime;
        this.ingest(await this.file('livemoni'));
      }
      this.setStatus(running);
    } catch { /* keep the last data and try again */ }
    if (!this.closed) this.timer = setTimeout(() => this.tick(), running ? 3000 : 60000);
  }

  /** Does the feed's current round belong to this event? (dates as YYYY-MM-DD) */
  matches(ev) {
    if (!this.master?.StartDay || !ev.start || !ev.end) return true;
    return this.master.StartDay <= ev.end.replace(/-/g, '') && this.master.EndDay >= ev.start.replace(/-/g, '');
  }

  emit(collection) { this.dispatchEvent(new CustomEvent('change', { detail: { collection } })); }

  setStatus(running) {
    const prev = this.docs.get('session_status')?.status;
    const next = { isFinished: !!this.final, isSessionRunning: running, currentFlag: 'GF' };
    if (prev && prev.isFinished === next.isFinished && prev.isSessionRunning === next.isSessionRunning) return;
    this.docs.set('session_status', { status: next });
    this.emit('session_status');
  }

  ingest(live) {
    const m = this.master || {};
    this.final = live.IsFinal === 1;
    this.live = live;

    const entry = {};
    const names = new Set();
    for (const c of live.LiveData) {
      const e = m.EntryInfo?.[c.CarNo] || {};
      names.add(c.Class);
      const drivers = e.Drivers || {};
      // current driver first, using romanised names
      const order = [c.Driver, ...Object.keys(drivers).filter((k) => k !== c.Driver)];
      entry[c.CarNo] = {
        class: c.Class,
        vehicle: e.Chassis || e.CarNameEngL || e.CarNameL || '',
        team: e.TeamNameEngL || e.TeamNameL || '',
        drivers: Object.fromEntries(order.filter((k) => drivers[k]).map((k) => [k, { name: drivers[k].eNameL || drivers[k].jNameL }])),
      };
    }
    this.docs.set('session_entry', { entry });

    const classes = {};
    [...names].forEach((name, i) => { classes[name] = { name, order: i + 1, background: PALETTE[i % PALETTE.length] }; });
    this.docs.set('session_classes', { classes: { classes } });

    const standings = {};
    for (const c of live.LiveData) {
      // position 0 means not classified: list those last
      const classified = +c.POS > 0;
      standings[c.CarNo] = {
        // same layout as Al Kamel: pos;number;state;class pos;laps;pits;top speed;lap start;track status;current lap
        data: `${classified ? c.POS : 900 + (999 - +c.LAPS)};${c.CarNo};${classified ? 'CLASSIFIED' : 'NOT_CLASSIFIED'};${c.PIC};${c.LAPS};${c.PitCnt};0;${c.TotalTime};${c.IsPit ? 'BOX' : 'TRACK'};${+c.LAPS + 1};`,
        class: c.Class,
        lastLapTime: c.LapTime,
        bestLapTime: c.BestLapTime,
        elapsedTime: c.TotalTime,
        isCheckered: this.final,
      };
    }
    this.docs.set('session_info', { info: { champName: 'Super Taikyu', eventName: m.RaceNameEngL || '', name: m.RoundNo ? `Round ${m.RoundNo}` : '', type: 'RACE' } });
    this.docs.set('track_info', { track: { name: m.RaceNameEngL } });
    this.emit('session_entry');
    this.emit('session_classes');
    this.docs.set('standings', { standings: { standings } });
    this.emit('standings');
  }
}

export class TaikyuRace extends LiveRace {
  /** @param track from loadTrack(): the feed has no outline of its own */
  constructor(client, series, track) {
    super(client, series);
    this.track = track;
    const n = track.speed.length;
    this.K = track.speed.reduce((a, s) => a + 1 / s, 0) / n;
    // share of a lap's time spent up to each point of the track
    let t = 0;
    this.timeAt = track.speed.map((s) => { const v = t; t += 1 / s; return v / (this.K * n); });
    this.raceMs = 0;
    this.raceAt = performance.now();
  }

  get sourceName() { return 'Super Taikyu live timing'; }
  get posLabel() { return 'ESTIMATED TRACK POS'; }
  get positionsEstimated() { return true; }

  onChange(collection) {
    super.onChange(collection);
    if (collection === 'standings') this.syncSectors();
  }

  buildTrack() { /* fixed in the constructor */ }
  syncPositions() { /* no positions in this feed */ }

  /** Lap position for a share of the lap's time. */
  pAtTime(tf) {
    const a = this.timeAt;
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= tf) lo = m; else hi = m - 1; }
    return lo / a.length;
  }

  syncSectors() {
    const rows = this.client.live?.LiveData || [];
    this.raceMs = Math.max(0, ...rows.map((c) => c.NowTotalTime || 0));
    this.raceAt = performance.now();
    for (const r of rows) {
      const c = this.byNum.get(r.CarNo);
      if (!c || !r.NowTotalTime) continue;
      const best = r.BestLapSect2SectTime?.some(Boolean) ? r.BestLapSect2SectTime : r.Sect2SectTime;
      const count = +this.client.master?.SectorMax || best.filter(Boolean).length;
      // index 0 holds the last sector (back to the line); 1.. run in lap order
      const lap = best[0] + best.slice(1, count).reduce((a, b) => a + b, 0) || 1;
      const upTo = (pos) => best.slice(1, pos + 1).reduce((a, b) => a + b, 0) / lap;
      c.crossTf = upTo(r.NowSectorPos);
      c.capTf = r.NowSectorPos + 1 >= count ? 0.995 : Math.min(0.995, upTo(r.NowSectorPos + 1) + 0.02);
      c.crossMs = r.NowTotalTime;
      const p = c.laps + this.pAtTime(c.crossTf);
      if (c.anchorP == null) { c.p = p; c.pred = p; }
      c.anchorP = p;
    }
  }

  advance(dt) {
    this.t += dt;
    const s = this.status();
    const running = s.isSessionRunning && !s.isFinished;
    const now = this.raceMs + (performance.now() - this.raceAt);
    for (const c of this.cars) {
      if (c.anchorP == null) continue;
      let tf = c.crossTf;
      // between crossings, assume the car is on its usual pace, up to the next timing point
      if (running && !c.inPit) tf = Math.min(c.capTf, c.crossTf + Math.max(0, now - c.crossMs) / (c.pace * 1000));
      c.pred = c.laps + this.pAtTime(tf);
      const diff = c.pred - c.p;
      if (diff > 0.2 || diff < -0.03) c.p = c.pred;
      else if (diff > 0) c.p += diff * Math.min(1, dt * 5);
    }
  }

  flagInfo() {
    const s = this.status();
    if (s.isFinished) return { text: 'FINISH', cls: '' };
    if (!s.isSessionRunning) return { text: 'NOT RUNNING', cls: 'neutral' };
    return { text: 'NO FLAG DATA', cls: 'neutral' }; // this feed doesn't publish flags
  }

  clockInfo() {
    const s = this.status();
    const running = s.isSessionRunning && !s.isFinished;
    const ms = this.raceMs + (running ? performance.now() - this.raceAt : 0);
    return { elapsed: ms / 1000, remaining: s.isFinished ? 'Chequered flag' : running ? '' : 'No session running' };
  }
}
