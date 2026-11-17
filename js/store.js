// State persistence (localStorage) and private GitHub Gist sync.
import { DEFAULT_PROGRAM } from './programs.js';
import { ALL_EQUIPMENT } from './exercises.js';

const KEY = 'liftapp.v1';
const SECRET_KEY = 'liftapp.gist'; // token + gist id stay on this device, never uploaded
const GIST_FILE = 'workout-app-data.json';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const todayISO = () => new Date().toLocaleDateString('en-CA');

function defaults() {
  return {
    version: 1,
    updatedAt: Date.now(),
    settings: {
      unit: 'lb',
      restDays: [0], // Sunday
      activeProfile: 'gym',
      activeProgram: DEFAULT_PROGRAM.id,
      mesoStart: 0, // index into completed sessions of this program where the current block began
    },
    profiles: {
      gym: { name: 'Commercial Gym', equip: [...ALL_EQUIPMENT] },
    },
    programs: { [DEFAULT_PROGRAM.id]: structuredClone(DEFAULT_PROGRAM) },
    rotation: { [DEFAULT_PROGRAM.id]: 0 },
    customExercises: {},
    sessions: [], // completed workouts, newest last
    active: null, // in-progress workout
    deleted: [], // ids of deleted sessions (so sync doesn't resurrect them)
  };
}

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch (e) { console.warn('load failed', e); }
  return defaults();
}

let pushTimer = null;
export function save({ sync = true } = {}) {
  state.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
  if (sync && (gist().token || dropbox().refresh)) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushAll().catch(err => setSyncStatus('error', err.message)), 2500);
  }
}

async function pushAll() {
  if (gist().token) await pushGist();
  if (dropbox().refresh) await pushDropbox();
}

export function replaceState(next) {
  state = { ...defaults(), ...next };
  save();
}

export function resetAll() {
  state = defaults();
  save({ sync: false });
}

// ---------- Gist sync ----------
export function gist() {
  try { return JSON.parse(localStorage.getItem(SECRET_KEY)) || {}; } catch { return {}; }
}
export function setGist(g) { localStorage.setItem(SECRET_KEY, JSON.stringify({ ...gist(), ...g })); }

export const syncStatus = { state: 'off', msg: '', at: null };
const listeners = new Set();
export const onSync = fn => listeners.add(fn);
function setSyncStatus(s, msg = '') {
  Object.assign(syncStatus, { state: s, msg, at: Date.now() });
  listeners.forEach(fn => fn(syncStatus));
}

async function gh(path, opts = {}) {
  const { token } = gist();
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

const payload = () => {
  const { active, ...rest } = state; // in-progress workout stays local
  return JSON.stringify(rest);
};

export async function pushGist() {
  const g = gist();
  if (!g.token) return;
  setSyncStatus('syncing');
  const files = { [GIST_FILE]: { content: payload() } };
  if (!g.id) {
    const created = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'Workout App data (private)', public: false, files }) });
    setGist({ id: created.id });
  } else {
    await gh(`/gists/${g.id}`, { method: 'PATCH', body: JSON.stringify({ files }) });
  }
  setSyncStatus('ok', 'Saved to Gist');
}

// Pull remote, merge sessions by id, keep the newer copy of everything else.
export async function pullGist() {
  const g = gist();
  if (!g.token) return false;
  setSyncStatus('syncing');
  if (!g.id) {
    // Look for an existing data gist on this account before creating a new one.
    const list = await gh('/gists?per_page=100');
    const found = list.find(x => x.files && x.files[GIST_FILE]);
    if (!found) { await pushGist(); return true; }
    setGist({ id: found.id });
  }
  const remoteGist = await gh(`/gists/${gist().id}`);
  const file = remoteGist.files[GIST_FILE];
  if (!file) { await pushGist(); return true; }
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url)).text();
  const remote = JSON.parse(content);
  merge(remote);
  save({ sync: false });
  await pushGist();
  return true;
}

function merge(remote) {
  const deleted = new Set([...(state.deleted || []), ...(remote.deleted || [])]);
  const byId = new Map();
  for (const s of [...(remote.sessions || []), ...state.sessions]) {
    if (deleted.has(s.id)) continue;
    const prev = byId.get(s.id);
    if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) byId.set(s.id, s);
  }
  const sessions = [...byId.values()].sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
  const newer = (remote.updatedAt || 0) > state.updatedAt ? remote : state;
  const active = state.active;
  state = {
    ...defaults(),
    ...newer,
    customExercises: { ...(remote.customExercises || {}), ...state.customExercises, ...(newer.customExercises || {}) },
    sessions,
    deleted: [...deleted],
    active,
  };
}

export async function syncNow() {
  try {
    if (gist().token) await pullGist();
    if (dropbox().refresh) await pullDropbox();
  } catch (e) { setSyncStatus('error', e.message); throw e; }
}

// ---------- Dropbox sync ----------
// Uses your own Dropbox app (App folder access) with OAuth PKCE, so no secret is needed and
// nothing passes through a server. Files land in Dropbox/Apps/<your app name>/.
const DBX_KEY = 'liftapp.dropbox'; // app key + tokens stay on this device, never uploaded
const DBX_FILE = '/workout-app-data.json';
export function dropbox() {
  try { return JSON.parse(localStorage.getItem(DBX_KEY)) || {}; } catch { return {}; }
}
export function setDropbox(d) { localStorage.setItem(DBX_KEY, JSON.stringify({ ...dropbox(), ...d })); }
export function clearDropbox() { const { appKey } = dropbox(); localStorage.setItem(DBX_KEY, JSON.stringify({ appKey })); }
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Sign-in without a redirect: Dropbox shows a code, you paste it back into the app. This works
// from an iPhone home-screen app, where a redirect would land in Safari's separate storage.
export async function connectDropbox() {
  const { appKey } = dropbox();
  if (!appKey) throw new Error('Paste your Dropbox app key first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  setDropbox({ verifier, error: null });
  const q = new URLSearchParams({ client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
  return 'https://www.dropbox.com/oauth2/authorize?' + q;
}

async function dbxToken(params) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: dropbox().appKey, ...params }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Dropbox sign-in failed: ${j.error_description || j.error || res.status}`);
  return j;
}

export async function finishDropboxCode(code) {
  const { verifier } = dropbox();
  if (!verifier) throw new Error('Tap "Get code from Dropbox" first, then paste the code here.');
  const j = await dbxToken({ grant_type: 'authorization_code', code: code.trim(), code_verifier: verifier });
  setDropbox({ refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, verifier: null, error: null });
}

async function dbxAccess() {
  const d = dropbox();
  if (d.access && d.exp > Date.now()) return d.access;
  let j;
  try { j = await dbxToken({ grant_type: 'refresh_token', refresh_token: d.refresh }); } catch (e) { setDropbox({ error: e.message }); throw e; }
  setDropbox({ access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

async function dbxContent(endpoint, arg, body) {
  const res = await fetch('https://content.dropboxapi.com/2/files/' + endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await dbxAccess()}`, 'Dropbox-API-Arg': JSON.stringify(arg), ...(body != null && { 'Content-Type': 'application/octet-stream' }) },
    body,
  });
  if (res.status === 409 && endpoint === 'download') return null; // file not there yet
  if (!res.ok) throw new Error(`Dropbox ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res;
}

// Save any file to the app folder, e.g. an exported program.
export async function saveToDropbox(path, text) {
  await dbxContent('upload', { path: path.startsWith('/') ? path : '/' + path, mode: 'overwrite', mute: true }, text);
}

export async function pushDropbox() {
  if (!dropbox().refresh) return;
  setSyncStatus('syncing');
  const data = payload();
  try {
    await saveToDropbox(DBX_FILE, data);
    // One dated copy per day, so a bad change can be rolled back.
    await saveToDropbox(`/backups/workout-backup-${todayISO()}.json`, data);
  } catch (e) { setDropbox({ error: e.message }); throw e; }
  setDropbox({ error: null, at: Date.now() });
  setSyncStatus('ok', 'Saved to Dropbox');
}

export async function pullDropbox() {
  if (!dropbox().refresh) return false;
  setSyncStatus('syncing');
  let res;
  try { res = await dbxContent('download', { path: DBX_FILE }); } catch (e) { setDropbox({ error: e.message }); throw e; }
  if (res) { merge(JSON.parse(await res.text())); save({ sync: false }); }
  await pushDropbox();
  return true;
}
