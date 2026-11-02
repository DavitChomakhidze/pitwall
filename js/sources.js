// Which real timing source a race can use. Everything else is simulated: Swiss
// Timing (GTWC Europe, DTM, GT Masters) and Super GT's RaceLive refuse outside
// access, and TSL / Time Service / wige aren't connected yet.

import { ALKAMEL_FEEDS, checkRunningFeeds } from './alkamel.js';

const fresh = (stamp) => {
  // "20261025_170606307" is Japan time (UTC+9)
  const m = /^(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)/.exec(stamp || '');
  return !!m && Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) < 3 * 60 * 1000;
};
export const isFreshTaikyu = fresh;

/**
 * @returns {{kind:'alkamel', feed:string, name:string, champ?:RegExp} | {kind:'taikyu', name:string} | null}
 *   `champ` picks the series' own sessions on a feed shared with support races.
 */
export function liveSourceFor(seriesId, ev = {}) {
  if (seriesId === 'taikyu') return { kind: 'taikyu', name: 'Super Taikyu timing' };
  if (ALKAMEL_FEEDS[seriesId]) return { kind: 'alkamel', feed: ALKAMEL_FEEDS[seriesId], name: 'Al Kamel' };
  if (seriesId === 'gtwca') return { kind: 'alkamel', feed: 'usac_sro', name: 'Al Kamel', champ: /GT World Challenge America|GTWC America|IGTC Indianapolis/i };
  // IGTC changes provider per event; only Indianapolis runs on Al Kamel
  if (seriesId === 'igtc' && /indianapolis/i.test(`${ev.name} ${ev.circuit}`)) return { kind: 'alkamel', feed: 'usac_sro', name: 'Al Kamel', champ: /IGTC|Indianapolis 8/i };
  return null;
}

/** Which sources are running now: { "al:imsa": true, taikyu: false, … }. */
export async function checkRunningSources() {
  const out = {};
  const [feeds, taikyu] = await Promise.all([
    checkRunningFeeds().catch(() => ({})),
    fetch('/api/taikyu?file=updateinfo').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  for (const [feed, running] of Object.entries(feeds)) out[`al:${feed}`] = running;
  out.taikyu = fresh(taikyu?.LiveMoniUpdateTime);
  return out;
}

export const sourceKey = (src) => (src?.kind === 'alkamel' ? `al:${src.feed}` : src?.kind);
