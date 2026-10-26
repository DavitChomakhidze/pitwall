// Pitwall dev server: serves the site and one small API the browser can't do
// itself (YouTube sends no CORS headers): list a channel's live / upcoming /
// past streams so the race view can show the real broadcast and onboards.
//
//   node server.js            → http://localhost:5180
//   PORT=8080 node server.js
//
// No dependencies; needs Node 18+ (global fetch).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 5180;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+1; SOCS=CAI', // skip the EU consent page
};

// ---------------------------------------------------------------- YouTube streams

const streamCache = new Map(); // channelId → { at, data }
const embedCache = new Map(); // videoId → boolean
const STREAM_TTL = 90 * 1000;

/** Live, upcoming and recent past streams of a channel, newest first. */
async function channelStreams(channelId) {
  const hit = streamCache.get(channelId);
  if (hit && Date.now() - hit.at < STREAM_TTL) return hit.data;

  const html = await (await fetch(`https://www.youtube.com/channel/${channelId}/streams`, { headers: YT_HEADERS })).text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('unexpected YouTube page');
  const data = JSON.parse(m[1]);

  const items = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.lockupViewModel) {
      const l = o.lockupViewModel;
      const badges = [];
      (function w(x) { if (!x || typeof x !== 'object') return; if (x.thumbnailBadgeViewModel) badges.push(x.thumbnailBadgeViewModel); for (const k in x) w(x[k]); })(l.contentImage);
      const meta = l.metadata?.lockupMetadataViewModel;
      const lines = (JSON.stringify(meta?.metadata || {}).match(/"content":"([^"]+)"/g) || []).map((s) => s.slice(11, -1));
      const live = badges.some((b) => /LIVE/.test(b.badgeStyle || ''));
      const upcoming = badges.some((b) => /upcoming/i.test(b.text || '')) || lines.some((s) => /^Scheduled for/i.test(s));
      items.push({
        id: l.contentId,
        title: meta?.title?.content || '',
        status: live ? 'live' : upcoming ? 'upcoming' : 'past',
        when: lines.find((s) => /Scheduled for|Streamed|ago/i.test(s)) || '',
        start: null,
      });
    }
    for (const k in o) walk(o[k]);
  })(data);

  // embeddable? (oEmbed answers 401 when the owner disabled embedding)
  await Promise.all(items.filter((v, i) => v.status !== 'past' || i < 8).map(async (v) => { v.embeddable = await embeddable(v.id); }));
  // exact start time for upcoming streams (the list only has a localised "Scheduled for …" string)
  await Promise.all(items.filter((v) => v.status === 'upcoming').slice(0, 8).map(async (v) => { v.start = await scheduledStart(v.id); }));
  streamCache.set(channelId, { at: Date.now(), data: items });
  return items;
}

const startCache = new Map();
async function scheduledStart(id) {
  if (startCache.has(id)) return startCache.get(id);
  let iso = null;
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: YT_HEADERS })).text();
    const m = html.match(/"scheduledStartTime":"(\d+)"/);
    if (m) iso = new Date(+m[1] * 1000).toISOString();
  } catch { /* leave unknown */ }
  startCache.set(id, iso);
  return iso;
}

async function embeddable(id) {
  if (embedCache.has(id)) return embedCache.get(id);
  let ok = true;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { headers: YT_HEADERS });
    ok = r.status === 200;
  } catch { /* assume yes */ }
  embedCache.set(id, ok);
  return ok;
}

// ---------------------------------------------------------------- HTTP

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/streams') {
    const ch = url.searchParams.get('channel') || '';
    if (!/^UC[\w-]{22}$/.test(ch)) return send(res, 400, { error: 'bad channel id' });
    try { return send(res, 200, await channelStreams(ch)); } catch (e) { return send(res, 502, { error: e.message }); }
  }

  // static files, never outside ROOT
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
  if (!path || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || /(^|[\\/])\./.test(path)) return send(res, 404, 'Not found', 'text/plain');
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
});

server.listen(PORT, () => console.log(`Pitwall on http://localhost:${PORT}`));
