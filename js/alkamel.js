// Minimal client for Al Kamel Systems live timing (livetiming.alkamelsystems.com).
// The site is a Meteor app: a SockJS websocket speaking DDP. We subscribe to a
// series feed, find its current session and subscribe to that session's
// timing collections. Every collection is kept merged in `this.data`.

const HOST = 'livetiming.alkamelsystems.com';

/** Pitwall series id → Al Kamel feed name. */
export const ALKAMEL_FEEDS = { wec: 'fiawec', elms: 'elms', imsa: 'imsa', alms: 'alms' };

const SESSION_SUBS = [
  'entry', 'sessionStatus', 'sessionClasses', 'standings', 'sessionPositioning',
  'sessionCircuitPath', 'trackInfo', 'raceControl', 'pitInfo', 'weather', 'sessionCircuitStatus',
];

const oid = (id) => ({ $type: 'oid', $value: id });
const oidVal = (o) => (o && typeof o === 'object' ? o.$value : o);
const rid = () => Math.random().toString(36).slice(2, 10);

export class AlKamelClient extends EventTarget {
  /**
   * @param {string} feed  Al Kamel feed name, e.g. "imsa"
   * @param {object} opts  { sessionId?: string } — pin a specific (e.g. finished) session
   */
  constructor(feed, { sessionId = null } = {}) {
    super();
    this.feed = feed;
    this.pinnedSession = sessionId;
    this.sessionId = null;
    this.data = new Map(); // collection → Map(id → fields)
    this.subId = 0;
    this.sessionSubs = [];
    this.retry = 0;
    this.closed = false;
    this.feedInfo = null;
  }

  connect() {
    const url = `wss://${HOST}/sockjs/${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}/${rid()}/websocket`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.onFrame(String(ev.data));
    ws.onclose = () => {
      this.emit('status', { connected: false });
      if (this.closed) return;
      const wait = Math.min(30000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify([JSON.stringify(msg)]));
  }

  sub(name, params) {
    const id = String(++this.subId);
    this.send({ msg: 'sub', id, name, params });
    return id;
  }

  onFrame(frame) {
    if (frame === 'o') { this.send({ msg: 'connect', version: '1', support: ['1', 'pre2', 'pre1'] }); return; }
    if (frame === 'h' || frame[0] !== 'a') return;
    for (const raw of JSON.parse(frame.slice(1))) this.onMessage(JSON.parse(raw));
  }

  onMessage(m) {
    switch (m.msg) {
      case 'ping': this.send({ msg: 'pong', id: m.id }); return;
      case 'connected':
        this.retry = 0;
        this.data.clear();
        this.sessionId = null;
        this.emit('status', { connected: true });
        this.sub('livetimingFeed', [this.feed]);
        if (this.pinnedSession) this.useSession(this.pinnedSession);
        return;
      case 'added': this.coll(m.collection).set(m.id, m.fields || {}); break;
      case 'changed': {
        const doc = this.coll(m.collection).get(m.id) || {};
        for (const [k, v] of Object.entries(m.fields || {})) setPath(doc, k, v);
        for (const k of m.cleared || []) setPath(doc, k, undefined);
        this.coll(m.collection).set(m.id, doc);
        break;
      }
      case 'removed': this.coll(m.collection).delete(m.id); break;
      default: return;
    }
    this.afterChange(m.collection, m.msg);
    this.emit('change', { collection: m.collection });
  }

  afterChange(collection, kind) {
    if (collection === 'feeds') {
      const feed = this.one('feeds');
      this.feedInfo = feed;
      if (kind === 'added' && feed?.sessions?.length) {
        this.sub('sessionInfo', [feed.sessions]);
        this.sub('sessions', [feed.sessions]);
      }
    }
    if (collection === 'session_info' && !this.pinnedSession) {
      const id = oidVal(this.one('session_info')?.session);
      if (id && id !== this.sessionId) this.useSession(id);
    }
    if (collection === 'sessions') {
      const events = [...new Set([...this.coll('sessions').values()].map((s) => oidVal(s.event)).filter(Boolean))];
      const key = events.sort().join(',');
      if (key && key !== this.eventsKey) { this.eventsKey = key; this.sub('events', [events.map(oid)]); }
    }
  }

  useSession(id) {
    for (const sid of this.sessionSubs) this.send({ msg: 'unsub', id: sid });
    // drop the old session's documents
    for (const name of ['session_entry', 'session_status', 'session_classes', 'standings', 'session_positioning',
      'session_circuit_config', 'track_info', 'race_control', 'session_pit_info', 'weather', 'session_circuit_status']) this.data.delete(name);
    this.sessionId = id;
    this.sessionSubs = SESSION_SUBS.map((n) => this.sub(n, [oid(id)]));
    this.emit('session', { id });
  }

  coll(name) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name);
  }

  /** First document of a collection that belongs to the active session (or any doc if not session-scoped). */
  one(name) {
    for (const doc of this.coll(name).values()) {
      const s = oidVal(doc.session);
      if (!s || !this.sessionId || s === this.sessionId) return doc;
    }
    return null;
  }

  /** Finished + live sessions of this feed, newest first, labelled with their event name. */
  sessionList() {
    const events = new Map([...this.coll('events').entries()].map(([id, e]) => [id, e]));
    return [...this.coll('sessions').entries()].map(([id, s]) => {
      const ev = events.get(oidVal(s.event));
      return {
        id,
        name: s.name,
        date: typeof s.date === 'object' ? s.date.$date : s.date,
        event: ev?.name || ev?.info?.name || '',
        champ: ev?.champName || ev?.info?.champName || '',
      };
    }).sort((a, b) => b.date - a.date);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
}

/** One-shot check: which of our feeds are running right now. Resolves {seriesId: boolean}. */
export function checkRunningFeeds(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const result = {};
    const byFeed = Object.fromEntries(Object.entries(ALKAMEL_FEEDS).map(([s, f]) => [f, s]));
    let ws;
    const done = () => { try { ws?.close(); } catch { /* ignore */ } resolve(result); };
    try {
      ws = new WebSocket(`wss://${HOST}/sockjs/${Math.floor(Math.random() * 900 + 100)}/${rid()}/websocket`);
    } catch { resolve(result); return; }
    const send = (m) => ws.send(JSON.stringify([JSON.stringify(m)]));
    let n = 0;
    ws.onmessage = (ev) => {
      const d = String(ev.data);
      if (d === 'o') { send({ msg: 'connect', version: '1', support: ['1'] }); return; }
      if (d[0] !== 'a') return;
      for (const raw of JSON.parse(d.slice(1))) {
        const m = JSON.parse(raw);
        if (m.msg === 'connected') Object.values(ALKAMEL_FEEDS).forEach((f, i) => send({ msg: 'sub', id: String(i + 1), name: 'livetimingFeed', params: [f] }));
        if (m.msg === 'added' && m.collection === 'feeds' && byFeed[m.fields.name]) {
          result[byFeed[m.fields.name]] = !!m.fields.running;
          if (++n === Object.keys(ALKAMEL_FEEDS).length) done();
        }
      }
    };
    ws.onerror = done;
    setTimeout(done, timeoutMs);
  });
}
