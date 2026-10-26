// Schedule data layer. Reads each series' season page on Wikipedia, finds the
// calendar table and turns it into events. Results are cached in localStorage
// so the page loads instantly and Wikipedia is hit at most every few hours.

import { SERIES } from './series.js';

const CACHE_TTL = 12 * 60 * 60 * 1000;
const CACHE_VERSION = 2;
const CONCURRENCY = 3;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// ---------- Wikipedia API ----------

export async function wiki(params, attempt = 0) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  const all = { ...params, format: 'json', formatversion: 2, origin: '*', redirects: 1 };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return wiki(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || data.error.code);
  return data;
}

async function fetchCalendarHtml(title) {
  const { parse } = await wiki({ action: 'parse', page: title, prop: 'sections' });
  const sec = parse.sections.find((s) => /calendar|schedule/i.test(s.line));
  if (!sec) throw new Error('no calendar section');
  const { parse: p2 } = await wiki({ action: 'parse', page: title, prop: 'text', section: sec.index });
  return p2.text;
}

// ---------- table parsing ----------

// Expand rowspan/colspan into a plain 2D grid of cell texts.
export function tableToGrid(table) {
  const grid = [];
  [...table.rows].forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of tr.cells) {
      while (grid[r][c] !== undefined) c++;
      const text = cell.textContent.replace(/\s+/g, ' ').trim();
      const rs = Math.min(+cell.rowSpan || 1, 60);
      const cs = Math.min(+cell.colSpan || 1, 20);
      for (let i = 0; i < rs; i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = { text, th: cell.tagName === 'TH' };
      }
      c += cs;
    }
  });
  return grid;
}

function findCol(header, re) {
  return header.findIndex((h) => h && re.test(h));
}

/** Parse "10–12 April", "January 24–25", "6/7 April", "30 May – 1 June", "19 April". */
export function parseDateRange(text) {
  const tokens = text.match(/[A-Za-z]{3,}|\d+/g) || [];
  const items = []; // {day} or {month}
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const n = +t;
      if (n >= 1 && n <= 31) items.push({ day: n });
    } else {
      const m = MONTHS[t.slice(0, 3).toLowerCase()];
      if (m !== undefined) items.push({ month: m });
    }
  }
  const monthFirst = items.length && items[0].month !== undefined;
  const days = [];
  items.forEach((it, i) => {
    if (it.day === undefined) return;
    let month;
    if (monthFirst) {
      for (let j = i; j >= 0; j--) if (items[j].month !== undefined) { month = items[j].month; break; }
    } else {
      for (let j = i; j < items.length; j++) if (items[j].month !== undefined) { month = items[j].month; break; }
      if (month === undefined) for (let j = i; j >= 0; j--) if (items[j].month !== undefined) { month = items[j].month; break; }
    }
    if (month !== undefined) days.push({ day: it.day, month });
  });
  if (!days.length) return null;
  return { first: days[0], last: days[days.length - 1] };
}

const clean = (s) => (s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

function parseCalendar(html, series, title) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, sup, .locmap, .reference, link').forEach((n) => n.remove());

  const tables = [...doc.querySelectorAll('table.wikitable')];
  for (const table of tables) {
    const grid = tableToGrid(table);
    // Sprint series (DTM, GT Masters) have "Race 1 / Race 2" columns holding dates instead of "Date".
    const isDateHead = (t) => /date/i.test(t) || /^race \d$/i.test(t);
    const hIdx = grid.findIndex((row) => row && row.some((c) => c && c.th && isDateHead(c.text)));
    if (hIdx < 0) continue;
    const header = grid[hIdx].map((c) => (c ? c.text : ''));
    const raceDayCols = header.map((h, i) => (/^race \d$/i.test(h) ? i : -1)).filter((i) => i >= 0);
    const col = {
      round: findCol(header, /^(rnd|round|r)\.?$/i),
      race: raceDayCols.length ? -1 : findCol(header, /^(race|event|race name|name)/i),
      circuit: findCol(header, /circuit|track|venue/i),
      location: findCol(header, /location/i),
      date: findCol(header, /date/i),
      format: findCol(header, /^(series|cup|format|length)/i),
    };
    if (col.circuit < 0) col.circuit = col.location;
    if (col.circuit < 0) continue;

    const seasonStartYear = +title.match(/\d{4}/)[0];
    let year = seasonStartYear;
    let prevMonth = -1;
    const events = [];

    for (const row of grid.slice(hIdx + 1)) {
      if (!row) continue;
      // Everything below a "Cancelled races" / "Postponed" divider is not on the calendar.
      const distinct = new Set(row.filter(Boolean).map((c) => c.text));
      if (distinct.size === 1 && /cancel|postpon|abandon|replaced/i.test([...distinct][0])) break;
      const get = (i) => (i >= 0 && row[i] ? clean(row[i].text) : '');
      const dateText = col.date >= 0 ? get(col.date) : raceDayCols.map(get).join(' ');
      const range = parseDateRange(dateText);
      if (!range) continue;
      if (!range) return;
      if (prevMonth >= 0 && range.first.month < prevMonth - 1) year++;
      prevMonth = range.last.month;
      const start = new Date(year, range.first.month, range.first.day);
      const endYear = range.last.month < range.first.month ? year + 1 : year;
      const end = new Date(endYear, range.last.month, range.last.day);
      const singleDay = start.getTime() === end.getTime();
      // A single listed date is the race day; the weekend starts a day earlier.
      if (singleDay) start.setDate(start.getDate() - 1);

      const circuitFull = get(col.circuit);
      const circuit = circuitFull.split(',')[0].trim();
      let location = get(col.location);
      if (!location || location === circuitFull) location = circuitFull.split(',').slice(1).join(',').trim();
      const roundRaw = get(col.round);
      const name = get(col.race) || circuit;
      const isTest = /prologue|test|roar/i.test(name) || /prologue|test/i.test(roundRaw);

      events.push({
        seriesId: series.id,
        round: /^\d+$/.test(roundRaw) ? +roundRaw : null,
        name,
        circuit,
        location,
        format: get(col.format),
        start: toISO(start),
        end: toISO(end),
        isTest,
      });
    }
    if (events.length) return events;
  }
  throw new Error('no calendar table');
}

const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// ---------- loading + caching ----------

async function loadSeriesYear(series, year) {
  const events = [];
  let lastErr = null;
  for (const title of series.pages(year)) {
    try {
      const html = await fetchCalendarHtml(title);
      events.push(...parseCalendar(html, series, title));
    } catch (e) {
      lastErr = e;
    }
  }
  const inYear = events.filter((e) => e.start.startsWith(String(year)) || e.end.startsWith(String(year)));
  if (!inYear.length && lastErr) throw lastErr;
  return inYear;
}

async function pool(items, worker, n) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  }));
  return out;
}

const cacheKey = (year) => `racehub:schedule:v${CACHE_VERSION}:${year}`;

function readCache(year) {
  try { return JSON.parse(localStorage.getItem(cacheKey(year))); } catch { return null; }
}
function writeCache(year, value) {
  try { localStorage.setItem(cacheKey(year), JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

/**
 * Load every series' events for `year`.
 * Returns { events, errors: {seriesId: message}, fetchedAt, fromCache }.
 */
export async function loadYear(year, { force = false, onProgress } = {}) {
  const cached = readCache(year);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) return { ...cached, fromCache: true };

  let done = 0;
  const errors = {};
  const results = await pool(SERIES, async (s) => {
    try {
      return await loadSeriesYear(s, year);
    } catch (e) {
      errors[s.id] = e.message;
      // keep last good data for this series if we have it
      return cached ? cached.events.filter((ev) => ev.seriesId === s.id) : [];
    } finally {
      onProgress?.(++done, SERIES.length);
    }
  }, CONCURRENCY);

  const events = results.flat().sort((a, b) => a.start.localeCompare(b.start) || a.seriesId.localeCompare(b.seriesId));
  const value = { events, errors, fetchedAt: Date.now() };
  if (events.length) writeCache(year, value);
  return { ...value, fromCache: false };
}

// ---------- time windows ----------

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Friday→Sunday of the current weekend (if today is Fri–Sun) or the next one. */
export function weekendWindow(today = new Date(), offsetWeeks = 0) {
  const t = dayStart(today);
  const dow = t.getDay(); // 0 Sun … 6 Sat
  const toFriday = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
  const fri = addDays(t, toFriday + offsetWeeks * 7);
  return { from: fri, to: addDays(fri, 2) };
}

const overlaps = (ev, from, to) => fromISO(ev.start) <= to && fromISO(ev.end) >= from;

export function eventStatus(ev, today = new Date()) {
  const t = dayStart(today);
  const s = fromISO(ev.start);
  const e = fromISO(ev.end);
  if (t >= s && t <= e) return 'live';
  if (t > e) return 'done';
  return 'upcoming';
}

export function bucketEvents(events, today = new Date()) {
  const thisW = weekendWindow(today, 0);
  const nextW = weekendWindow(today, 1);
  return {
    live: events.filter((e) => eventStatus(e, today) === 'live'),
    thisWeekend: events.filter((e) => overlaps(e, thisW.from, thisW.to) && eventStatus(e, today) !== 'live'),
    nextWeekend: events.filter((e) => overlaps(e, nextW.from, nextW.to)),
    windows: { thisW, nextW },
  };
}
