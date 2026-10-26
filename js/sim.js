// Race simulation. Stands in for a live timing feed: it produces the same
// things a real feed would (car positions, laps, gaps, pit stops, flags) and
// emits "action" events the UI turns into popups. Swap this module for a real
// timing adapter later and the race view keeps working.

import { cornerAt } from './tracks.js';
import { teamColour, textOn } from './liveries.js';
import { classesFor } from './series.js';

const MAKES = {
  proto: ['Toyota GR010', 'Ferrari 499P', 'Porsche 963', 'Cadillac V-Series.R', 'BMW M Hybrid V8', 'Alpine A424', 'Peugeot 9X8', 'Aston Martin Valkyrie', 'Acura ARX-06'],
  lmp2: ['Oreca 07'],
  lmp3: ['Ligier JS P325', 'Duqueine D09', 'Ginetta G61-LT-P3'],
  gt500: ['Toyota GR Supra', 'Honda Prelude-GT', 'Nissan Z NISMO'],
  gt3: ['Porsche 911 GT3 R', 'Ferrari 296 GT3', 'BMW M4 GT3 Evo', 'Mercedes-AMG GT3', 'Audi R8 LMS', 'Lamborghini Huracán GT3', 'McLaren 720S GT3', 'Aston Martin Vantage AMR', 'Ford Mustang GT3', 'Corvette Z06 GT3.R', 'Lexus RC F GT3'],
  gt4: ['Porsche 718 Cayman GT4', 'BMW M4 GT4', 'Toyota GR Supra GT4', 'Aston Martin Vantage GT4', 'McLaren Artura GT4'],
  cup: ['Porsche 911 GT3 Cup'],
  tcr: ['Hyundai Elantra N TCR', 'Audi RS3 LMS', 'Cupra León VZ TCR'],
};
const FIRST = ['Alex', 'Marco', 'Kenji', 'Lucas', 'Nico', 'Sam', 'Jonas', 'Mateo', 'Theo', 'Ryo', 'Felix', 'Oliver', 'Daniel', 'Leo', 'Yuki', 'Hugo', 'Max', 'Andrea', 'Tom', 'Rafael', 'Erik', 'Ivan', 'Pablo', 'Sven'];
const LAST = ['Novak', 'Bianchi', 'Sato', 'Moreau', 'Keller', 'Hughes', 'Lind', 'Costa', 'Weber', 'Tanaka', 'Fischer', 'Dubois', 'Rossi', 'Berg', 'Kovac', 'Silva', 'Vogel', 'Laurent', 'Brennan', 'Okafor', 'Nakamura', 'Petrov', 'Haas', 'Moreno'];

// Average lap speed per car class, scaled so the gaps between classes match
// real multiclass races (e.g. Spa WEC: Hypercar ~2:02, LMGT3 ~2:17 → ×1.12;
// Daytona: GTP 1:35, LMP2 1:39, GTD 1:46).
function profile(cls) {
  const c = cls.toLowerCase();
  if (/hypercar|gtp/.test(c)) return { kind: 'proto', kmh: 196 };
  if (/gt500/.test(c)) return { kind: 'gt500', kmh: 190 };
  if (/lmp2/.test(c)) return { kind: 'lmp2', kmh: 184 };
  if (/lmp3/.test(c)) return { kind: 'lmp3', kmh: 176 };
  if (/gt4|st-z|invitational/.test(c)) return { kind: 'gt4', kmh: 152 };
  if (/cup|992/.test(c)) return { kind: 'cup', kmh: 162 };
  if (/tce|tcr|sp4t|st-q|st-[1-5]|others/.test(c)) return { kind: 'tcr', kmh: 146 };
  if (/gtx/.test(c)) return { kind: 'gt3', kmh: 166 };
  if (/sp-x/.test(c)) return { kind: 'gt3', kmh: 176 };
  return { kind: 'gt3', kmh: 172 }; // GT3 and its driver categories (Pro, Gold, Silver, Bronze, Am …)
}

// Same car, different driver line-up: FIA ratings make Am crews a bit slower.
function driverTier(cls) {
  const c = cls.toLowerCase();
  if (/bronze/.test(c)) return 1.016;
  if (/silver-am/.test(c)) return 1.012;
  if (/pro-am/.test(c)) return 1.008;
  if (/\bam\b/.test(c)) return 1.018;
  if (/silver/.test(c)) return 1.008;
  if (/gold/.test(c)) return 1.004;
  return 1;
}

export function raceDurationSec(eventName, series) {
  const h = eventName.match(/(\d+)\s*(hours?|h\b|stunden)/i);
  if (h) return +h[1] * 3600;
  const km = eventName.match(/(\d{3,4})\s*km/i);
  if (km) return Math.round((+km[1] / 165) * 3600);
  return series.type === 'endurance' ? 6 * 3600 : 3600;
}

export class RaceSim {
  constructor({ series, track, eventName, seed = Date.now() }) {
    this.series = series;
    this.track = track;
    this.eventName = eventName;
    this.duration = raceDurationSec(eventName, series);
    this.endurance = series.type === 'endurance' || this.duration >= 3 * 3600;
    this.seed = seed >>> 0;
    this.t = 0;
    this.flag = 'green';
    this.flagUntil = 0;
    this.yellow = null; // {from, to, until} lap-fraction window
    this.listeners = [];
    this.classBest = {};
    this.pairSince = new Map();
    this.pairCooldown = new Map();
    this.nextIncident = 0;
    this.quiet = true;

    const n = track.speed.length;
    // Lap time = pace · mean(1/speed) / K, so K = mean(1/speed) keeps laps on target.
    this.K = track.speed.reduce((a, s) => a + 1 / s, 0) / n;
    this.buildField();
  }

  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2 ** 32; }
  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { if (!this.quiet) this.listeners.forEach((fn) => fn({ ...ev, t: this.t })); }

  buildField() {
    const used = new Set();
    this.classList = classesFor(this.series, this.eventName);
    const total = this.classList.reduce((a, c) => a + c[2], 0);
    const scale = total > 44 ? 44 / total : 1; // keep the map readable
    this.cars = [];
    this.classList.forEach(([cls, color, count], clsIdx) => {
      const prof = profile(cls);
      // Classes are listed fastest first; same-car classes (Pro/Am) differ by driver pace.
      const baseLap = (this.track.length / 1000 / prof.kmh) * 3600 * driverTier(cls);
      const m = Math.max(2, Math.round(count * scale));
      for (let i = 0; i < m; i++) {
        let num;
        do { num = 1 + Math.floor(this.rnd() * 99); } while (used.has(num));
        used.add(num);
        const make = this.pick(MAKES[prof.kind]);
        this.cars.push({
          id: num, num, cls, clsIdx, color, make,
          team: `${this.pick(LAST)} ${this.pick(['Racing', 'Motorsport', 'Competition', 'Engineering', 'Sport'])}`,
          drivers: [0, 1, 2].map(() => `${this.pick(FIRST)[0]}. ${this.pick(LAST)}`),
          pace: baseLap * (1 + (this.rnd() - 0.5) * 0.007 + i * 0.0004),
          p: 0, lap: 0, lapStartT: 0, lastLap: null, bestLap: null,
          noise: 1, inPit: false, pitUntil: 0, lastPitT: -1e9, nextPit: 0,
          slowUntil: 0, lane: (this.rnd() - 0.5) * 0.7, stint: 0,
        });
        const car = this.cars[this.cars.length - 1];
        car.teamColor = teamColour(car.team, car.make);
        car.textColor = textOn(car.teamColor);
      }
    });

    // Drop into the race already in progress (about a third of the way in).
    const T0 = Math.min(this.duration * 0.35, 3 * 3600);
    for (const c of this.cars) {
      c.p = (T0 / c.pace) * (1 - this.rnd() * 0.0015);
      c.lap = Math.floor(c.p);
      c.lapStartT = -((c.p % 1) * c.pace);
      c.stint = this.stintLaps(c);
      c.nextPit = c.lap + 1 + Math.floor(this.rnd() * c.stint);
    }
    this.t = 0;
    this.raceStartT = -T0;
    this.nextIncident = 240 + this.rnd() * 600;
    // settle a few seconds silently so gaps / orders are initialised
    for (let i = 0; i < 40; i++) this.step(0.25);
    this.quiet = false;
  }

  stintLaps(c) {
    if (this.endurance) return Math.max(6, Math.round((50 * 60) / c.pace));
    return Math.max(4, Math.round(this.duration / 2 / c.pace));
  }

  elapsed() { return this.t - this.raceStartT; }
  remaining() { return Math.max(0, this.duration - this.elapsed()); }

  gapSec(a, b) { return (a.p - b.p) * b.pace; }

  // ---------- interface shared with LiveRace (used by race.js) ----------

  get isLive() { return false; }
  get ready() { return true; }
  classes() { return this.classList.map(([n, c]) => [n, c]); }
  label() { return 'Simulation'; }

  gapLabel(lead, c) {
    if (c === lead) return null;
    const laps = Math.floor(lead.p - c.p);
    return laps >= 1 ? `+${laps} L` : `+${this.gapSec(lead, c).toFixed(1)}`;
  }

  /** Parts of the lap under caution: [{from, to, kind: 'yellow'|'double'|'fcy'|'red'}]. */
  yellowZones() {
    const z = [];
    if (this.flag === 'fcy') z.push({ from: 0, to: 1, kind: 'fcy' });
    if (this.yellow && this.t < this.yellow.until) z.push({ from: this.yellow.from, to: this.yellow.to, kind: this.flag === 'fcy' ? 'double' : 'yellow' });
    return z;
  }

  flagInfo() {
    if (this.remaining() <= 0) return { text: 'FINISH', cls: '' };
    if (this.flag === 'fcy') return { text: 'FCY', cls: 'sc' };
    if (this.yellow && this.t < this.yellow.until) return { text: 'YELLOW', cls: 'yellow' };
    return { text: 'GREEN', cls: '' };
  }

  clockInfo() {
    const r = this.remaining();
    return { elapsed: this.elapsed(), remaining: r > 0 ? `${fmtClock(r)} to go` : 'Chequered flag' };
  }

  speedFactorAt(c) {
    const n = this.track.speed.length;
    const i = Math.floor((((c.p % 1) + 1) % 1) * n);
    let f = this.track.speed[i] * this.K * c.noise;
    if (this.flag === 'fcy') f = Math.min(f, 0.5);
    if (this.yellow && this.t < this.yellow.until && this.inYellow(c.p)) f = Math.min(f, 0.6);
    if (c.slowUntil > this.t) f *= 0.18;
    if (this.gripAt) f *= this.gripAt(c.p); // set by the race view from the real weather
    return f;
  }

  inYellow(p) {
    const x = ((p % 1) + 1) % 1;
    const { from, to } = this.yellow;
    return from <= to ? x >= from && x <= to : x >= from || x <= to;
  }

  /** km/h for HUD */
  speedKmh(c) {
    if (c.inPit) return 60;
    return (this.speedFactorAt(c) / c.pace) * this.track.length * 3.6;
  }

  advance(dt) {
    if (this.finished) return;
    if (this.remaining() <= 0) {
      this.finished = true;
      const winner = this.order()[0];
      this.emit({ kind: 'finish', title: 'Chequered flag', text: `#${winner.num} ${winner.make} wins the ${this.series.short} race!`, cars: [winner.id] });
      return;
    }
    let left = dt;
    while (left > 0) {
      const h = Math.min(0.25, left);
      this.step(h);
      left -= h;
    }
    this.detect();
  }

  step(dt) {
    this.t += dt;
    if (this.flag === 'fcy' && this.t >= this.flagUntil) {
      this.flag = 'green';
      this.emit({ kind: 'green', title: 'Green flag', text: 'Full course yellow withdrawn — racing resumes.' });
    }
    if (this.yellow && this.t >= this.yellow.until) this.yellow = null;
    if (!this.quiet && this.t >= this.nextIncident) this.incident();

    for (const c of this.cars) {
      if (c.inPit) {
        if (this.t >= c.pitUntil) {
          c.inPit = false;
          this.emitIfFront(c, { kind: 'pit', title: 'Pit exit', text: `#${c.num} ${c.make} rejoins after its stop.` });
        }
        continue;
      }
      c.p += (dt * this.speedFactorAt(c)) / c.pace;
      if (Math.floor(c.p) > c.lap) this.completeLap(c);
    }
  }

  completeLap(c) {
    c.lap = Math.floor(c.p);
    const lapTime = this.t - c.lapStartT;
    c.lapStartT = this.t;
    c.lastLap = lapTime;
    c.noise = 1 + (this.rnd() - 0.5) * 0.012;
    const clean = this.flag === 'green' && lapTime < c.pace * 1.15;
    if (clean && (!c.bestLap || lapTime < c.bestLap)) c.bestLap = lapTime;
    if (clean && !this.quiet && (!this.classBest[c.cls] || lapTime < this.classBest[c.cls])) {
      const had = !!this.classBest[c.cls];
      this.classBest[c.cls] = lapTime;
      if (had) this.emit({ kind: 'fastest', title: `Fastest lap · ${c.cls}`, text: `#${c.num} ${c.make} — ${fmtLap(lapTime)}`, cars: [c.id] });
    } else if (clean && !this.classBest[c.cls]) {
      this.classBest[c.cls] = lapTime;
    }
    if (c.lap >= c.nextPit && this.remaining() > c.pace * 2) {
      c.inPit = true;
      c.pitUntil = this.t + (this.endurance ? 62 + this.rnd() * 22 : 58 + this.rnd() * 8);
      c.lastPitT = this.t;
      c.p = c.lap + 0.0005;
      c.nextPit = c.lap + c.stint + Math.round((this.rnd() - 0.5) * 4);
      this.emitIfFront(c, { kind: 'pit', title: 'Pit stop', text: `#${c.num} ${c.make} (P${this.classPos(c)} ${c.cls}) dives into the pits.` });
    }
  }

  emitIfFront(c, ev) {
    if (this.classPos(c) <= 3) this.emit({ ...ev, cars: [c.id] });
  }

  incident() {
    const pool = this.cars.filter((c) => !c.inPit);
    const c = this.pick(pool);
    const where = cornerAt(this.track, c.p);
    c.slowUntil = this.t + 18 + this.rnd() * 20;
    const x = ((c.p % 1) + 1) % 1;
    this.yellow = { from: (x - 0.03 + 1) % 1, to: (x + 0.04) % 1, until: this.t + 70 };
    const what = this.pick(['spins at', 'runs wide at', 'goes off at', 'has contact at', 'slows with a problem after']);
    this.emit({ kind: 'incident', title: 'Incident', text: `#${c.num} ${c.make} ${what} ${where}. Local yellow.`, cars: [c.id] });
    if (this.rnd() < 0.18) {
      this.flag = 'fcy';
      this.flagUntil = this.t + 140 + this.rnd() * 80;
      this.emit({ kind: 'fcy', title: 'Full course yellow', text: 'Race neutralised while marshals recover the car.', cars: [c.id] });
    }
    this.nextIncident = this.t + 420 + this.rnd() * 1200;
  }

  // ---------- standings ----------

  order() {
    return [...this.cars].sort((a, b) => b.p - a.p);
  }

  classPos(car) {
    let pos = 1;
    for (const c of this.cars) if (c.cls === car.cls && c.p > car.p) pos++;
    return pos;
  }

  detect() {
    const ord = this.order();
    const byClass = {};
    for (const c of ord) (byClass[c.cls] ||= []).push(c);

    // overall leader change
    const leader = ord[0];
    if (this.prevLeader && this.prevLeader !== leader.id && !leader.inPit) {
      const old = this.cars.find((c) => c.id === this.prevLeader);
      if (old && !old.inPit && this.t - old.lastPitT > 120) {
        this.emit({ kind: 'lead', title: 'New race leader', text: `#${leader.num} ${leader.make} takes the lead from #${old.num}.`, cars: [leader.id, old.id] });
      }
    }
    this.prevLeader = leader.id;

    for (const [cls, list] of Object.entries(byClass)) {
      const prev = this.prevClassOrder?.[cls];
      const posNow = new Map(list.map((c, i) => [c.id, i]));
      if (prev) {
        list.forEach((c, i) => {
          const was = prev.get(c.id);
          if (was === undefined || i >= was || i > 5) return;
          const passed = list[i + 1];
          if (!passed || prev.get(passed.id) !== i) return;
          const recentPit = (x) => x.inPit || this.t - x.lastPitT < 150;
          if (recentPit(c) || recentPit(passed)) return;
          this.emit({ kind: 'overtake', title: `Overtake · ${cls}`, text: `#${c.num} ${c.make} passes #${passed.num} for P${i + 1}.`, cars: [c.id, passed.id] });
        });
      }
      (this.prevClassOrder ||= {})[cls] = posNow;

      // battles: within 0.8 s for a while, top 5 of the class
      for (let i = 0; i < Math.min(list.length - 1, 5); i++) {
        const a = list[i], b = list[i + 1];
        const key = `${a.id}-${b.id}`;
        const close = !a.inPit && !b.inPit && this.gapSec(a, b) < 0.8;
        if (!close) { this.pairSince.delete(key); continue; }
        if (!this.pairSince.has(key)) this.pairSince.set(key, this.t);
        const cool = this.pairCooldown.get(key) || 0;
        if (this.t - this.pairSince.get(key) > 40 && this.t > cool) {
          this.pairCooldown.set(key, this.t + 900);
          this.emit({ kind: 'battle', title: `Battle for P${i + 1} · ${cls}`, text: `#${b.num} ${b.make} is all over the back of #${a.num} ${a.make}.`, cars: [a.id, b.id] });
        }
      }
    }
  }
}

export function fmtLap(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

export function fmtClock(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}
