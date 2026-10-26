// Official live broadcasts and onboard streams on YouTube.
//
// The local server (server.js) reads each channel's live / upcoming / past
// streams; here we pick the ones that belong to the race on screen: the right
// series (`match`, only needed on channels shared by several series, like
// SRO's GT World) at the right circuit, English first. Onboard cameras are
// streams whose title says "onboard"/"in-car" and names a car number — the
// Nürburgring 24h, for example, streams many cars that way.

const GT_WORLD = 'UC-yHapH6mW1ceZ_5PDUf1_g'; // SRO: GTWC, IGTC, British GT …

export const BROADCAST = {
  wec: { channels: ['UCwU7U7PiarcJKLjDJTnANjw'], match: null }, // full races are on WEC TV; YouTube has onboards + some sessions
  imsa: { channels: ['UC58em84jwiyM20qR-iqBDZw'], match: /WeatherTech|Rolex 24/i }, // the channel also carries IMSA's support series
  elms: { channels: ['UCU8C8RqGhqH4nhk4mlN1Vwg'], match: null },
  alms: { channels: ['UCYnmhsw6smiACWopUlPAfOg'], match: null },
  igtc: {
    channels: [GT_WORLD], match: /Intercontinental|IGTC|24 Hours of Spa|Bathurst|Suzuka|Indianapolis 8|8 Hour/i,
    // the Nürburgring 24h has its own channel, with onboard streams for many cars
    eventChannels: [[/n[uü]rburgring/i, ['UCKgMzHVA7nsDsDEKKMc9bKA']]],
  },
  gtwce: { channels: [GT_WORLD], match: /GT World Challenge Europe|GTWC Europe|Endurance Cup|Sprint Cup/i },
  gtwca: { channels: [GT_WORLD], match: /GT World Challenge America|GTWC America/i },
  gtwcas: { channels: [GT_WORLD], match: /GT World Challenge Asia|GTWC Asia/i },
  gtwcau: { channels: [GT_WORLD], match: /GT World Challenge Australia|GTWC Australia/i },
  dtm: { channels: ['UCwKq447rYMVI5dAQWMmFnfg'], match: /DTM/i },
  supergt: { channels: ['UCy-v0TWgjklAlOq-chcI4GA'], match: null },
  britgt: { channels: [GT_WORLD, 'UC1zPq11wTtSBpp5_gq4gwQA'], match: /British GT/i },
  adac: { channels: ['UCMehJkatrBnXQnjQ7dWID7A'], match: /GT Masters/i },
  gtopen: { channels: ['UClUba2oDx-Mau1rBVD51QKA'], match: /GT Open/i },
  nls: { channels: ['UCQU0BQ0FK1X-t1MXw_6q9yQ'], match: null },
  '24h': { channels: ['UCopWjPe1QbOFNf1dMs97E-w'], match: /24H SERIES|Creventic|Hankook/i },
  taikyu: { channels: ['UC8sfQKfk_4_JePSHSupvT4w'], match: null },
};

// words that say nothing about which event a stream belongs to
const STOP = new Set(['circuit', 'international', 'race', 'racing', 'hours', 'hour', 'grand', 'prix', 'speedway', 'raceway', 'motor', 'park',
  'autodromo', 'autódromo', 'internacional', 'nazionale', 'course', 'the', 'and', 'world', 'challenge', 'series', 'championship', 'round',
  'road', 'live', 'presented', 'powered',
  // title sponsors appear on many unrelated events
  'michelin', 'motul', 'rolex', 'bapco', 'energies', 'totalenergies', 'crowdstrike', 'liqui', 'moly', 'hankook', 'pirelli', 'fanatec', 'ravenol', 'eneos', 'bridgestone']);
const tokens = (...texts) => [...new Set(texts.join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CJK = /[぀-ヿ㐀-鿿]/;
const ONBOARD = /on-?board|in-?car|cockpit|car cam/i;

let serverOk = true;

async function fetchChannel(id) {
  const r = await fetch(`/api/streams?channel=${id}`);
  if (r.status === 404) { serverOk = false; throw new Error('no server'); }
  if (!r.ok) throw new Error(`streams HTTP ${r.status}`);
  return r.json();
}

/**
 * Streams for an event.
 * @returns {{ server: boolean, sessions: Stream[], broadcast: Stream|null, onboards: Map<string, Stream> }}
 *   Stream = { id, title, status: 'live'|'upcoming'|'past', start, when, embeddable }
 */
export async function findStreams(series, ev) {
  const cfg = BROADCAST[series.id];
  const empty = { server: serverOk, sessions: [], broadcast: null, onboards: new Map() };
  if (!cfg) return empty;
  const extra = (cfg.eventChannels || []).filter(([re]) => re.test(`${ev.name} ${ev.circuit}`)).flatMap(([, ids]) => ids);
  const channels = [...new Set([...extra, ...cfg.channels])];

  const lists = await Promise.all(channels.map((id) => fetchChannel(id).catch(() => [])));
  if (!serverOk) return { ...empty, server: false };
  const all = lists.flat();
  const words = tokens(ev.circuit, ev.location, ev.name);
  const dedicated = extra.length > 0; // event channel: everything on it is this event

  // A stream belongs to this event if it names the series and the venue.
  const scored = all.map((v) => {
    const t = plain(v.title);
    const venue = words.filter((w) => t.includes(w)).length;
    const series = cfg.match ? cfg.match.test(v.title) : true;
    // single-series channel: whatever is live or coming up is this weekend's event
    // (titles may not name the venue in English, e.g. Super Taikyu's 岡山)
    const ownChannel = !cfg.match && v.status !== 'past';
    if (/e-?sports|sim racing|gaming/i.test(v.title)) return null;
    // last year's race at the same track is not this one
    const year = v.title.match(/\b(20\d\d)\b/);
    if (year && ev.start && year[1] !== ev.start.slice(0, 4)) return null;
    if (!dedicated && !ownChannel && (!series || !venue)) return null;
    if (dedicated && v.status === 'past' && !venue) return null;
    let score = venue * 2 + (series ? 3 : 0);
    if (/🇬🇧|english/i.test(v.title) || !CJK.test(v.title)) score += 4;
    if (/\brace\b|rennen|決勝/i.test(v.title)) score += 2;
    return { ...v, score };
  }).filter(Boolean);

  // onboard streams keyed by the car number in the title
  const onboards = new Map();
  for (const v of scored) {
    if (!ONBOARD.test(v.title) || v.status === 'past') continue;
    for (const m of v.title.matchAll(/(?:#|no\.?\s?|car\s)(\d{1,3})\b/gi)) if (!onboards.has(m[1])) onboards.set(m[1], v);
  }

  // Sessions = the main broadcasts (not onboards), English first, one per title
  const seen = new Set();
  const sessions = scored.filter((v) => !ONBOARD.test(v.title))
    .sort((a, b) => b.score - a.score)
    .filter((v) => {
      // drop the other-language copy of the same session (same start time)
      const key = v.start || v.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const rank = { live: 0, upcoming: 1, past: 2 };
  sessions.sort((a, b) => rank[a.status] - rank[b.status]
    || (a.status === 'upcoming' ? Date.parse(a.start || 0) - Date.parse(b.start || 0) : 0)
    || b.score - a.score);

  // default: live now › next upcoming › latest replay (prefer a race over qualifying)
  const broadcast = sessions.find((v) => v.status === 'live')
    || sessions.find((v) => v.status === 'upcoming')
    || sessions.find((v) => v.status === 'past' && /\brace\b|rennen|決勝/i.test(v.title))
    || sessions[0] || null;

  return { server: true, sessions, broadcast, onboards };
}

export const embedUrl = (id) => `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** "LIVE", "in 3 h 20 min", "Sat 12:40", "Replay" */
export function statusText(v) {
  if (!v) return '';
  if (v.status === 'live') return 'LIVE';
  if (v.status === 'past') return 'Replay';
  if (!v.start) return 'Upcoming';
  const ms = Date.parse(v.start) - Date.now();
  if (ms < 0) return 'Starting';
  const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
  if (h < 24) return `in ${h ? `${h} h ` : ''}${m} min`;
  return new Date(v.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
