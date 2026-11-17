// Lift push server: holds a rest timer while the app is in the background and sends a
// Web Push notification when it runs out. No payload is sent, so no message encryption
// is needed; the app's service worker shows the "Rest over" notification itself.
// VAPID keys are generated on first use and kept in a Durable Object.

const ALLOWED_ORIGINS = ['https://kemoczulski-max.github.io'];
const SUBJECT = 'https://kemoczulski-max.github.io';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

function cors(req, res) {
  const o = req.headers.get('Origin');
  const h = new Headers(res.headers);
  if (o && (ALLOWED_ORIGINS.includes(o) || o.startsWith('http://localhost'))) h.set('Access-Control-Allow-Origin', o);
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers: h });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(req, new Response(null, { status: 204 }));
    const url = new URL(req.url);
    try {
      if (url.pathname === '/key') {
        const k = await env.KEYS.get(env.KEYS.idFromName('vapid')).fetch('https://k/get');
        return cors(req, json({ key: (await k.json()).pub }));
      }
      if (req.method === 'POST' && (url.pathname === '/schedule' || url.pathname === '/cancel')) {
        const body = await req.json();
        const endpoint = body.sub?.endpoint || body.endpoint;
        if (!endpoint || !/^https:\/\//.test(endpoint)) return cors(req, json({ error: 'bad subscription' }, 400));
        const stub = env.TIMER.get(env.TIMER.idFromName(endpoint));
        const r = await stub.fetch('https://t/' + url.pathname.slice(1), { method: 'POST', body: JSON.stringify(body) });
        return cors(req, new Response(await r.text(), { status: r.status }));
      }
      if (url.pathname === '/') return cors(req, new Response('Lift push server is running.'));
      return cors(req, new Response('Not found', { status: 404 }));
    } catch (e) {
      return cors(req, json({ error: e.message }, 500));
    }
  },
};

// One instance holds the VAPID key pair.
export class Keys {
  constructor(state) { this.state = state; }
  async fetch() {
    let k = await this.state.storage.get('vapid');
    if (!k) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      k = { jwk: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)) };
      await this.state.storage.put('vapid', k);
    }
    return json(k);
  }
}

// One instance per phone subscription; its alarm fires when the rest ends.
export class Timer {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const op = new URL(req.url).pathname.slice(1);
    const body = await req.json();
    if (op === 'cancel') {
      await this.state.storage.deleteAlarm();
      await this.state.storage.delete('sub');
      return new Response('cancelled');
    }
    const at = Number(body.at);
    if (!at || at < Date.now() - 5000 || at > Date.now() + 30 * 60 * 1000) return new Response('bad time', { status: 400 });
    await this.state.storage.put('sub', body.sub);
    await this.state.storage.setAlarm(Math.max(at, Date.now() + 100));
    return new Response('scheduled');
  }
  async alarm() {
    const sub = await this.state.storage.get('sub');
    if (!sub) return;
    await this.state.storage.delete('sub');
    const k = await (await this.env.KEYS.get(this.env.KEYS.idFromName('vapid')).fetch('https://k/get')).json();
    await sendPush(sub.endpoint, k);
  }
}

async function vapidJWT(aud, jwk) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function sendPush(endpoint, k) {
  const jwt = await vapidJWT(new URL(endpoint).origin, k.jwk);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { TTL: '120', Urgency: 'high', Authorization: `vapid t=${jwt}, k=${k.pub}`, 'Content-Length': '0' },
  });
  if (!res.ok) console.log('push failed', res.status, await res.text());
  return res.status;
}
