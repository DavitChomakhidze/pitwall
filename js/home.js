import { SERIES, seriesById } from './series.js';
import { loadYear, bucketEvents, eventStatus, fromISO } from './schedule.js';
import { ALKAMEL_FEEDS, checkRunningFeeds } from './alkamel.js';
import { raceDayForecast } from './weather.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'racehub:prefs';

const prefs = (() => {
  try { return { type: 'all', hidden: [], ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { return { type: 'all', hidden: [] }; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

const thisYear = new Date().getFullYear();
let year = thisYear;
let data = { events: [], errors: {} };
// Near the end of a season, the next weekends can fall in January.
let nextYearEvents = [];
// seriesId → true while its Al Kamel timing feed is running
let runningFeeds = {};

const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fmtRange = (ev) => {
  const s = fromISO(ev.start), e = fromISO(ev.end);
  return ev.start === ev.end ? fmt.format(e) : `${fmt.format(s)} – ${fmt.format(e)}`;
};

export function raceUrl(ev) {
  const p = new URLSearchParams({
    s: ev.seriesId, n: ev.name, c: ev.circuit, l: ev.location || '', a: ev.start, b: ev.end, r: ev.round ?? '',
  });
  return `race.html?${p}`;
}

const visible = (ev) => {
  const s = seriesById(ev.seriesId);
  if (prefs.hidden.includes(s.id)) return false;
  if (prefs.type !== 'all' && s.type !== prefs.type) return false;
  return true;
};

function card(ev) {
  const s = seriesById(ev.seriesId);
  const status = eventStatus(ev);
  const a = document.createElement('a');
  a.className = `card ${status}`;
  a.href = raceUrl(ev);
  a.style.setProperty('--series', s.color);
  a.innerHTML = `
    <div class="card-top">
      <span class="badge">${s.short}</span>
      ${status === 'live' ? '<span class="live-pill">LIVE</span>' : ''}
      ${ev.isTest ? '<span class="test-pill">TEST</span>' : ''}
      ${ALKAMEL_FEEDS[s.id] && status !== 'done' ? `<span class="timing-pill ${runningFeeds[s.id] ? 'on' : ''}">${runningFeeds[s.id] ? 'TIMING LIVE' : 'LIVE TIMING'}</span>` : ''}
      ${ev.round ? `<span class="round">Rd ${ev.round}</span>` : ''}
    </div>
    <div class="card-name">${esc(ev.name)}</div>
    <div class="card-meta">${esc(ev.circuit)}${ev.location ? ` · ${esc(ev.location)}` : ''}</div>
    <div class="card-date">${fmtRange(ev)}${ev.format ? ` · ${esc(ev.format)}` : ''}</div>
    <div class="card-foot"><span class="card-cta">${status === 'live' ? 'Open live view →' : 'Open race view →'}</span><span class="fc"></span></div>`;
  // race-day forecast (Open-Meteo forecasts reach ~16 days ahead)
  const days = (fromISO(ev.end) - new Date()) / 864e5;
  if (status !== 'done' && days < 15) {
    raceDayForecast(ev.location, ev.circuit, ev.end).then((f) => {
      if (!f) return;
      const fc = a.querySelector('.fc');
      fc.innerHTML = `${f.icon} ${f.max}° · <span class="${f.rain >= 50 ? 'rainy' : ''}">💧${f.rain ?? '—'}%</span>`;
      fc.title = `Race-day forecast: ${f.text}, max ${f.max}°C, ${f.rain}% chance of rain`;
    });
  }
  return a;
}

function fill(el, events, emptyText) {
  el.replaceChildren(...events.map(card));
  if (!events.length) el.innerHTML = `<p class="empty">${emptyText}</p>`;
}

function renderChips() {
  const wrap = $('seriesChips');
  wrap.replaceChildren(...SERIES.filter((s) => prefs.type === 'all' || s.type === prefs.type).map((s) => {
    const b = document.createElement('button');
    b.className = `chip series ${prefs.hidden.includes(s.id) ? '' : 'on'}`;
    b.style.setProperty('--series', s.color);
    b.textContent = s.short;
    b.title = s.name;
    b.onclick = () => {
      prefs.hidden = prefs.hidden.includes(s.id) ? prefs.hidden.filter((x) => x !== s.id) : [...prefs.hidden, s.id];
      savePrefs();
      render();
    };
    if (data.errors[s.id]) b.classList.add('warn');
    return b;
  }));
  document.querySelectorAll('#typeChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.type === prefs.type));
}

function renderCalendar(events) {
  const cal = $('calendar');
  cal.replaceChildren();
  const byMonth = new Map();
  for (const ev of events) {
    const m = fromISO(ev.end).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(ev);
  }
  let nextMarked = false;
  for (const [month, list] of byMonth) {
    const g = document.createElement('div');
    g.className = 'month';
    g.innerHTML = `<h3>${month}</h3>`;
    for (const ev of list) {
      const s = seriesById(ev.seriesId);
      const status = eventStatus(ev);
      const row = document.createElement('a');
      row.href = raceUrl(ev);
      row.className = `cal-row ${status}`;
      if (status === 'upcoming' && !nextMarked && year === thisYear) { row.classList.add('next'); nextMarked = true; }
      row.style.setProperty('--series', s.color);
      row.innerHTML = `
        <span class="cal-date">${fmtRange(ev)}</span>
        <span class="badge">${s.short}</span>
        <span class="cal-name">${esc(ev.name)}${ev.isTest ? ' <em>(test)</em>' : ''}</span>
        <span class="cal-circuit">${esc(ev.circuit)}</span>
        <span class="cal-status">${status === 'live' ? '<span class="live-pill">LIVE</span>' : status === 'done' ? 'Finished' : ''}</span>`;
      g.appendChild(row);
    }
    cal.appendChild(g);
  }
  if (!events.length) cal.innerHTML = '<p class="empty">No races found for this season yet — the calendar may not be published.</p>';
}

function render() {
  renderChips();
  const all = data.events.filter(visible);
  const combined = [...all, ...nextYearEvents.filter(visible)];
  const b = bucketEvents(year === thisYear ? combined : []);
  const wf = (w) => `${fmt.format(w.from)} – ${fmt.format(w.to)}`;
  $('thisWLabel').textContent = wf(b.windows.thisW);
  $('nextWLabel').textContent = wf(b.windows.nextW);
  $('liveBlock').hidden = !b.live.length;
  fill($('liveCards'), b.live, '');
  fill($('thisCards'), b.thisWeekend, 'No GT3 or endurance races this weekend.');
  fill($('nextCards'), b.nextWeekend, 'No GT3 or endurance races next weekend.');
  $('seasonCount').textContent = `${all.filter((e) => !e.isTest).length} races · ${year}`;
  renderCalendar(all);

  const errs = Object.entries(data.errors);
  $('errors').textContent = errs.length
    ? `Couldn't refresh: ${errs.map(([id]) => seriesById(id).short).join(', ')} (showing last saved data where available).`
    : '';
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

async function load(force = false) {
  $('yearLabel').textContent = year;
  $('syncStatus').textContent = 'Fetching calendars…';
  data = await loadYear(year, {
    force,
    onProgress: (d, t) => { $('syncStatus').textContent = `Fetching calendars ${d}/${t}…`; },
  });
  render();
  $('syncStatus').textContent = `Updated ${ago(data.fetchedAt)}`;

  // From October on, also pull next season so early-January races show up.
  if (year === thisYear && new Date().getMonth() >= 9) {
    const nxt = await loadYear(thisYear + 1, { force });
    nextYearEvents = nxt.events;
    render();
  }
}

$('prevYear').onclick = () => { year--; load(); };
$('nextYear').onclick = () => { year++; load(); };
$('refreshBtn').onclick = () => load(true);
document.querySelectorAll('#typeChips .chip').forEach((b) => {
  b.onclick = () => { prefs.type = b.dataset.type; savePrefs(); render(); };
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
checkRunningFeeds().then((r) => { runningFeeds = r; render(); });
