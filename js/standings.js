// Championship standings, read from the series' Wikipedia season page (the same
// page the calendar comes from, so it rolls over to the new season by itself).
// Every standings table there has a "Pos." column, a name column and a
// "Points" column; we keep those and drop the per-round results.

import { wiki, tableToGrid } from './schedule.js';

const TTL = 6 * 60 * 60 * 1000;
const VERSION = 1;

function readCache(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeCache(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or blocked */ } }

/**
 * @returns {Promise<{tables: {title, kind, rows: {pos, name, points}[]}[], page, fetchedAt} | null>}
 */
export async function loadStandings(series, year, { force = false } = {}) {
  const key = `racehub:standings:v${VERSION}:${series.id}:${year}`;
  const hit = readCache(key);
  if (!force && hit && Date.now() - hit.fetchedAt < TTL) return hit;

  // newest page first (winter series span two years)
  for (const title of [...series.pages(year)].reverse()) {
    try {
      const { parse } = await wiki({ action: 'parse', page: title, prop: 'text' });
      const tables = parseStandings(parse.text);
      if (tables.length) {
        const v = { tables, page: title, fetchedAt: Date.now() };
        writeCache(key, v);
        return v;
      }
    } catch { /* try the other page */ }
  }
  return hit || null;
}

const clean = (s) => (s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

function parseStandings(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, sup, .reference, link').forEach((n) => n.remove());
  // keep line-ups readable: "Buemi<br>Hartley" → "Buemi / Hartley"
  doc.querySelectorAll('br').forEach((br) => br.replaceWith(' / '));

  const out = [];
  let h2 = '', h3 = '', h4 = '', h5 = '';
  for (const el of doc.querySelectorAll('h2, h3, h4, h5, table.wikitable')) {
    if (el.tagName === 'H2') { h2 = clean(el.textContent); h3 = h4 = h5 = ''; continue; }
    if (el.tagName === 'H3') { h3 = clean(el.textContent); h4 = h5 = ''; continue; }
    if (el.tagName === 'H4') { h4 = clean(el.textContent); h5 = ''; continue; }
    if (el.tagName === 'H5') { h5 = clean(el.textContent); continue; }
    if (!/result|standing|championship|classification/i.test(h2 + h3 + h4 + h5)) continue;

    const grid = tableToGrid(el);
    const isPos = (t) => /^(pos|rank)/i.test(t);
    const hIdx = grid.findIndex((r) => r && r.some((c) => c && isPos(c.text)) && r.some((c) => c && /^(points|pts)/i.test(c.text)));
    if (hIdx < 0) continue;
    const header = grid[hIdx].map((c) => clean(c?.text));
    const posCol = header.findIndex(isPos);
    const ptsCol = header.findIndex((h) => /^(points|pts)/i.test(h));
    let nameCol = header.findIndex((h) => /driver|team|manufacturer|entrant|constructor|rider|name/i.test(h));
    if (nameCol < 0) nameCol = posCol + 1;
    // the name column's own header says what the table ranks
    const kind = /manufacturer|constructor/i.test(header[nameCol]) ? 'manufacturers'
      : /team|entrant/i.test(header[nameCol]) ? 'teams' : 'drivers';
    const carCol = header.findIndex((h, i) => i !== nameCol && /^(team|car)$/i.test(h));

    const rows = [];
    for (const r of grid.slice(hIdx + 1)) {
      if (!r) continue;
      const pos = clean(r[posCol]?.text);
      const name = clean(r[nameCol]?.text).replace(/^\/\s*|\s*\/$/g, '');
      const points = parseFloat(clean(r[ptsCol]?.text).replace(',', '.'));
      if (!/^\d+$/.test(pos) || !name || /^\d+$/.test(name) || Number.isNaN(points)) continue;
      const prev = rows[rows.length - 1];
      // drivers sharing a car are separate rows with the same position + points
      if (prev && prev.pos === +pos && prev.points === points && kind === 'drivers') {
        if (!prev.name.includes(name)) prev.name += ` / ${name}`;
        continue;
      }
      if (prev && prev.pos === +pos && prev.name === name) continue;
      const extra = carCol >= 0 ? clean(r[carCol]?.text) : '';
      // team tables keyed by car number read better as "#33 TF Sport"
      if (/^\d+$/.test(extra) && kind === 'teams') rows.push({ pos: +pos, name: `#${extra} ${name}`, team: '', points });
      else rows.push({ pos: +pos, name, team: extra, points });
    }
    if (!rows.length) continue;
    out.push({ title: tidyTitle([h3, h4, h5].filter(Boolean), kind), kind, rows });
  }
  return out;
}

const KIND_WORD = /driver|team|manufacturer|rookie/i;
const tidy = (s) => s.replace(/^Standings:\s*/i, '').replace(/World Endurance /, '')
  .replace(/championships?|standings|classification/gi, '').replace(/s['’](\s|$)/g, 's$1').replace(/'/g, '')
  .replace(/\s{2,}/g, ' ').trim();

/**
 * Name a table from the headings above it, most specific last:
 *  WEC  "Drivers' championships" › "Hypercar World Endurance Drivers' Championship" → "Hypercar Drivers"
 *  IMSA "Drivers' Championships" › "Standings: GT Daytona (GTD)"                    → "Drivers · GT Daytona (GTD)"
 *  GTWC "Drivers' championship standings" › "Overall" › "Gold Cup"                  → "Drivers · Gold Cup"
 *  Super GT "GT500" › "Drivers' championships"                                       → "GT500 · Drivers"
 */
function tidyTitle(levels, kind) {
  const deepest = levels[levels.length - 1] || '';
  if (KIND_WORD.test(deepest)) {
    const cls = levels.slice(0, -1).find((l) => !KIND_WORD.test(l) && !/result|standing/i.test(l));
    return (cls ? `${tidy(cls)} · ${tidy(deepest)}` : tidy(deepest)) || 'Standings';
  }
  const k = kind === 'drivers' ? 'Drivers' : kind === 'teams' ? 'Teams' : 'Manufacturers';
  return `${k} · ${tidy(deepest) || 'Overall'}`;
}
