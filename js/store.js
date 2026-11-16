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
  if (sync && gist().token) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushGist().catch(err => setSyncStatus('error', err.message)), 2500);
  }
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
  try { await pullGist(); } catch (e) { setSyncStatus('error', e.message); throw e; }
}
