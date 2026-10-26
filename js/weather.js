// Weather for a circuit, from Open-Meteo (free, no key; high-resolution models
// in Europe/US). We sample several points around the lap so a shower that only
// hits part of a long track (Spa, Le Mans, Nürburgring) shows up on that part.
// Model cells are ~1–3 km, so this is "where rain is likely", not a sensor.

import { loadTrack } from './tracks.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const SAMPLES = 8;
const REFRESH_MS = 10 * 60 * 1000;

// WMO weather codes → short text + emoji
const WMO = [
  [[0], 'Clear', '☀️'], [[1], 'Mostly clear', '🌤️'], [[2], 'Partly cloudy', '⛅'], [[3], 'Overcast', '☁️'],
  [[45, 48], 'Fog', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'], [[61, 63, 66, 80, 81], 'Rain', '🌧️'],
  [[65, 67, 82], 'Heavy rain', '🌧️'], [[71, 73, 75, 77, 85, 86], 'Snow', '🌨️'], [[95, 96, 99], 'Thunderstorm', '⛈️'],
];
export const describe = (code) => {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: '—', icon: '🌡️' };
};
const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// ---------------------------------------------------------------- geocoding

function cacheGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function cacheSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

/** Find coordinates for a place name like "Braselton, Georgia" or "Le Mans". */
export async function geocode(...names) {
  for (const raw of names.filter(Boolean)) {
    const key = `racehub:geo:${raw}`;
    const hit = cacheGet(key);
    if (hit) return hit;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const q of [parts[0], raw]) {
      try {
        const r = await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=1`);
        const d = await r.json();
        const g = d.results?.[0];
        if (g) { const v = { lat: g.latitude, lon: g.longitude }; cacheSet(key, v); return v; }
      } catch { /* try the next form */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------- per-track weather

export class TrackWeather extends EventTarget {
  /**
   * @param {object} opts { circuit, location } — names used to find coordinates
   */
  constructor({ circuit, location }) {
    super();
    this.circuit = circuit;
    this.location = location;
    this.state = null;
    this.rc = { wet: false, spots: [] }; // from race control messages
    this.live = null; // Al Kamel weather: { air, track, humidity, wind }
  }

  async start() {
    this.points = await this.samplePoints();
    if (!this.points) return;
    await this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  stop() { clearInterval(this.timer); }

  /** Lap fractions + coordinates to sample. Real outline → spread round the lap; otherwise one point. */
  async samplePoints() {
    const geoTrack = await loadTrack(this.circuit).catch(() => null);
    if (geoTrack?.real && geoTrack.toLatLon) {
      return Array.from({ length: SAMPLES }, (_, i) => {
        const at = (i + 0.5) / SAMPLES;
        const p = geoTrack.pts[Math.floor(at * geoTrack.pts.length)];
        return { at, ...geoTrack.toLatLon(p) };
      });
    }
    const g = await geocode(this.location, this.circuit);
    return g ? [{ at: 0.5, ...g }] : null;
  }

  async refresh() {
    const pts = this.points;
    const url = `${API}?latitude=${pts.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(4)).join(',')}`
      + '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
      + '&minutely_15=precipitation&past_minutely_15=4&forecast_minutely_15=8&timezone=auto';
    let data;
    try {
      const r = await fetch(url);
      data = await r.json();
    } catch { return; }
    const locs = Array.isArray(data) ? data : [data];
    if (!locs[0]?.current) return;

    const sections = locs.map((loc, i) => {
      const m = loc.minutely_15.precipitation.map((x) => x || 0);
      const past = m.slice(0, 4).reduce((a, b) => a + b, 0); // last hour
      const now = loc.current.precipitation || 0;
      const level = now >= 0.3 || past >= 0.8 ? 'wet' : now > 0 || past >= 0.1 ? 'damp' : 'dry';
      return { at: pts[i].at, from: pts[i].at - 0.5 / pts.length, to: pts[i].at + 0.5 / pts.length, now, past, level, next: m.slice(4) };
    });
    // Forecast: worst section per 15-min step
    const steps = sections[0].next.map((_, k) => Math.max(...sections.map((s) => s.next[k] || 0)));
    const times = locs[0].minutely_15.time.slice(4);
    const c = locs[0].current;
    const raining = sections.some((s) => s.now > 0);
    const firstRain = steps.findIndex((x) => x >= 0.1);
    const lastRain = raining ? steps.findIndex((x) => x < 0.05) : -1;
    let outlook;
    if (raining && lastRain > 0) outlook = `Easing in ~${lastRain * 15} min`;
    else if (raining) outlook = 'Rain continuing';
    else if (firstRain >= 0) outlook = `Rain in ~${Math.max(15, firstRain * 15)} min`;
    else outlook = 'Dry for the next 2 h';

    const prev = this.state;
    this.state = {
      at: Date.now(), sections, steps, times, outlook,
      air: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, windDir: compass(c.wind_direction_10m),
      ...describe(c.weather_code),
      wetCount: sections.filter((s) => s.level !== 'dry').length,
      perSection: sections.length > 1,
    };
    this.dispatchEvent(new CustomEvent('update', { detail: { prev, state: this.state } }));
  }

  /** Track condition at lap position p: 'wet' | 'damp' | 'dry' (race control overrides). */
  levelAt(p) {
    const x = ((p % 1) + 1) % 1;
    if (this.rc.spots.some((s) => Math.abs(s - x) < 0.04 || Math.abs(s - x) > 0.96)) return 'wet';
    const s = this.state?.sections;
    if (!s) return this.rc.wet ? 'wet' : 'dry';
    const sec = s.reduce((a, b) => (Math.abs(b.at - x) < Math.abs(a.at - x) ? b : a));
    if (this.rc.wet && sec.level === 'dry') return 'damp';
    return sec.level;
  }

  /**
   * Read a race-control message. Returns a short note if it changed the
   * track condition (e.g. "Race declared wet").
   * @param labels corner labels so "RAIN AT TURN 5" can be placed
   */
  readRaceControl(message, labels) {
    const m = (message || '').toUpperCase();
    if (/DECLARED\s+WET|WET\s+(RACE|SESSION|CONDITIONS)/.test(m)) { this.rc.wet = true; return 'Race declared wet'; }
    if (/DECLARED\s+DRY|DRY\s+(RACE|SESSION)/.test(m)) { this.rc.wet = false; this.rc.spots = []; return 'Race declared dry'; }
    if (/RAIN|SLIPPERY|WET|OIL|SURFACE/.test(m)) {
      const turns = [...m.matchAll(/\b(?:TURN|T)\s*(\d+)/g)].map((x) => +x[1]);
      const spots = turns.map((n) => labels?.find((l) => l.n === n)?.at).filter((x) => x != null);
      if (spots.length) {
        this.rc.spots.push(...spots);
        return /OIL/.test(m) ? `Slippery surface at ${turns.map((n) => `T${n}`).join(', ')}` : `Rain reported at ${turns.map((n) => `T${n}`).join(', ')}`;
      }
      if (/RAIN/.test(m)) return 'Rain reported by race control';
    }
    return null;
  }
}

// ---------------------------------------------------------------- race-day forecast (home page)

/** Daily forecast for a place on a date (YYYY-MM-DD), cached for 3 h. */
export async function raceDayForecast(location, circuit, dateISO) {
  const key = `racehub:fc:${location || circuit}:${dateISO}`;
  const hit = cacheGet(key);
  if (hit && Date.now() - hit.t < 3 * 3600 * 1000) return hit.v;
  const g = await geocode(location, circuit);
  if (!g) return null;
  try {
    const r = await fetch(`${API}?latitude=${g.lat}&longitude=${g.lon}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`);
    const d = await r.json();
    if (!d.daily?.time?.length) return null;
    const v = {
      ...describe(d.daily.weather_code[0]),
      max: Math.round(d.daily.temperature_2m_max[0]),
      rain: d.daily.precipitation_probability_max[0],
    };
    cacheSet(key, { t: Date.now(), v });
    return v;
  } catch { return null; }
}
