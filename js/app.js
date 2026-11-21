import { MUSCLES, EQUIPMENT, PATTERNS } from './exercises.js';
import * as E from './engine.js';
import { DEFAULT_PROGRAM } from './programs.js';
import { state, save, uid, todayISO, gist, setGist, syncNow, onSync, syncStatus, replaceState, resetAll, dropbox, setDropbox, clearDropbox, connectDropbox, finishDropboxCode, saveToDropbox } from './store.js';

// ================= helpers =================
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lib = () => E.library(state.customExercises);
const program = (id = state.settings.activeProgram) => state.programs[id] || Object.values(state.programs)[0];
const profile = () => state.profiles[state.settings.activeProfile] || Object.values(state.profiles)[0];
const ctx = (taken = []) => ({ equip: new Set(profile().equip), taken: new Set(taken) });
const unit = () => state.settings.unit;
const fmtW = w => (w == null || w === '' ? '—' : `${+(+w).toFixed(1)}`);
const gradeClass = g => (g.startsWith('A') ? 'g-a' : g.startsWith('B') ? 'g-b' : g.startsWith('C') ? 'g-c' : 'g-d');
const focusMuscles = day => day.muscles?.length ? day.muscles : E.FOCUS[day.focus] || null;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function programSessions(pid) { return state.sessions.filter(s => s.programId === pid); }

const DAY_MS = 864e5;
const dayNum = iso => Math.round(new Date(iso + 'T12:00').getTime() / DAY_MS);
const hasRestDays = p => p.days.some(E.isRestDay);
const isoShift = (iso, d) => { const x = new Date(iso + 'T12:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };

// Position a start date implies for a given day (used once, to place a program on import).
function datePos(p, startDate, iso = todayISO()) {
  const n = Math.max(0, dayNum(iso) - dayNum(startDate));
  return { dayIdx: n % p.days.length, cycleIdx: Math.floor(n / p.days.length) };
}

// The rotation only moves when a workout is finished. Rest days are the exception:
// each calendar day that passes without training after reaching one uses it up.
// state.lastDone[pid] is the date the current position was reached.
function markReached(pid, iso = todayISO()) {
  state.lastDone = state.lastDone || {};
  state.lastDone[pid] = iso;
}
function catchUpRest(p) {
  if (!state.lastDone?.[p.id]) return false;
  let moved = false;
  for (let g = 0; g < p.days.length; g++) {
    const rot = (state.rotation[p.id] || 0) % p.days.length;
    const anchor = state.lastDone[p.id];
    if (!E.isRestDay(p.days[rot]) || dayNum(todayISO()) - dayNum(anchor) < 2) break;
    advanceRotation(p, rot);
    state.lastDone[p.id] = isoShift(anchor, 1);
    moved = true;
  }
  return moved;
}

// Older versions could store a calendar start date. Convert it to a fixed position once.
function migrateCalendar() {
  let changed = false;
  for (const p of Object.values(state.programs)) {
    if (!p.startDate) continue;
    const pos = datePos(p, p.startDate);
    state.rotation[p.id] = pos.dayIdx;
    state.cycleIdx = state.cycleIdx || {};
    if (p.cycles?.length) state.cycleIdx[p.id] = Math.min(pos.cycleIdx, p.cycles.length - 1);
    markReached(p.id, isoShift(todayISO(), -1));
    delete p.startDate;
    changed = true;
  }
  if (changed) save();
}

function currentWeek(pid = state.settings.activeProgram) {
  const p = program(pid);
  if (!p) return E.mesoWeek(0, 1);
  if (p.cycles?.length) {
    const raw = state.cycleIdx?.[p.id] || 0;
    const idx = Math.min(raw, p.cycles.length - 1);
    const c = p.cycles[idx];
    return { ...c, idx, custom: true, total: p.cycles.length, done: raw >= p.cycles.length, label: c.label || `Cycle ${idx + 1}` };
  }
  const n = programSessions(pid).length - (state.settings.mesoStart || 0);
  return E.mesoWeek(Math.max(0, n), E.trainingDays(p).length || 1);
}
const effortText = week => week.effort || `RIR ${week.rir}`;
const daySlots = (day, week) => (day.slots || []).map(s => E.slotFor(s, week.idx));
const nextIdx = (p, i) => (i + 1) % p.days.length;

// Advance the rotation past day i; moving from the last day back to the first starts the next cycle.
function advanceRotation(p, i) {
  const next = nextIdx(p, i);
  state.rotation[p.id] = next;
  if (next === 0 && p.cycles?.length) {
    state.cycleIdx = state.cycleIdx || {};
    state.cycleIdx[p.id] = (state.cycleIdx[p.id] || 0) + 1;
  }
}

function history(exId) {
  const out = [];
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    for (const sl of s.slots) if (sl.ex === exId) {
      const sets = sl.log.filter(x => x.done && x.r && !x.sub && !x.warm).map(x => ({ w: x.w === '' || x.w == null ? null : +x.w, r: +x.r }));
      if (sets.length) out.push({ date: s.date, sets });
    }
  }
  return out;
}

// ---------- lift history, estimated 1RM and % table ----------
const loadStep = () => (unit() === 'kg' ? 2.5 : 5); // gym loads: nearest 5 lb / 2.5 kg
const roundLoad = w => E.roundTo(w, loadStep());
const bestSet = sets => sets.filter(x => x.w && x.r).reduce((b, x) => (!b || E.e1rm(x.w, x.r) > E.e1rm(b.w, b.r) ? x : b), null);
function liftStats(exId) {
  const hist = history(exId);
  const today = [];
  if (state.active) for (const sl of state.active.slots) if (sl.ex === exId) today.push(...sl.log.filter(x => x.done && x.w && x.r && !x.sub && !x.warm).map(x => ({ w: +x.w, r: +x.r })));
  const lastSets = today.length ? today : hist[0]?.sets || [];
  const top = bestSet(lastSets);
  const allTop = [lastSets, ...hist.map(h => h.sets)].map(bestSet).filter(Boolean).reduce((b, x) => (!b || E.e1rm(x.w, x.r) > E.e1rm(b.w, b.r) ? x : b), null);
  return {
    hist, today,
    e1rm: top ? E.e1rm(top.w, top.r) : 0, from: top, fromDate: today.length ? 'today' : hist[0]?.date,
    best: allTop ? E.e1rm(allTop.w, allTop.r) : 0, bestFrom: allTop,
  };
}
const PCTS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50];
const repsAt = p => Math.max(1, Math.round(30 * (100 / p - 1))); // Epley, inverted
const fmtDate = d => (d === 'today' ? 'today' : new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

// Put a weight in set j and carry it to later unfinished sets that were empty or matched the old weight.
function applyWeight(i, j, w) {
  const log = state.active.slots[i].log;
  const old = log[j].w;
  log[j].w = w;
  log.forEach((x, k) => { if (k > j && !x.done && !x.warm && !x.sub && (x.w === '' || x.w == null || x.w === old)) x.w = w; });
  save({ sync: false });
}

const videoLinks = name => [
  ['Jeff Nippard', `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' Jeff Nippard')}`],
  ['Athlean-X', `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' Athlean-X')}`],
];

// ================= UI state (not persisted) =================
const ui = {
  view: 'today',
  previewDay: null, // day id override for today
  preview: null, // { dayId, profile, slots }
  build: { muscles: [...E.FOCUS.push], focus: 'push', minutes: 60, slots: null, seed: 1 },
  editDay: null,
  progressEx: null,
  sheet: null,
  showRating: true,
};

// ================= rest timer & wake lock =================
let timerInt = null;
let wakeLock = null;
let audioCtx = null;

// Short sounds should play like a notification, ducking music instead of stopping it.
try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch {}

// Three-note chime, played twice.
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    const t0 = audioCtx.currentTime + 0.02;
    [0, 1.1].forEach(rep => [[660, 0], [880, 0.16], [1175, 0.32]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(g); g.connect(audioCtx.destination);
      const t = t0 + rep + d;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.start(t); o.stop(t + 0.5);
    }));
  } catch {}
  navigator.vibrate?.([300, 120, 300]);
}

// The next set to do, for the banner.
function nextSetText() {
  const a = state.active;
  if (!a) return '';
  const L = lib();
  for (const s of a.slots) {
    const j = s.log.findIndex(x => !x.done);
    if (j < 0) continue;
    const x = s.log[j];
    const what = x.sub ? (E.techOf(x.sub)?.short || 'next row') : x.warm ? 'warm-up' : `set ${workSets(s.log.slice(0, j + 1)).length}`;
    return `Next: ${L[s.ex]?.name || ''}, ${what}`;
  }
  return 'All sets done. Finish the workout.';
}

function restOver() {
  chime();
  const el = $('#rest-alert');
  $('#rest-alert-next').textContent = nextSetText();
  el.hidden = false;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function hideRestAlert() { const el = $('#rest-alert'); if (el) el.hidden = true; }

function startTimer(sec) {
  if (!state.active) return;
  state.active.timerEnd = Date.now() + sec * 1000;
  state.active.timerTotal = sec;
  hideRestAlert();
  save({ sync: false });
  // Unlock audio on iOS inside the user gesture.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
  tickTimer();
}

function tickTimer() {
  clearInterval(timerInt);
  const bar = $('#timer');
  const a = state.active;
  if (!a || !a.timerEnd) { bar.hidden = true; return; }
  bar.hidden = false;
  const draw = () => {
    const left = Math.round((a.timerEnd - Date.now()) / 1000);
    if (left <= 0) {
      bar.hidden = true;
      a.timerEnd = null;
      save({ sync: false });
      clearInterval(timerInt);
      restOver();
      return;
    }
    $('#timer-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#timer-fill').style.width = `${100 - (left / (a.timerTotal || 1)) * 100}%`;
  };
  draw();
  timerInt = setInterval(draw, 250);
}

// ---------- lock-screen rest notifications (via the Cloudflare push server) ----------
const PUSH_KEY = 'liftapp.push'; // server URL + this phone's subscription, never uploaded
const pushCfg = () => { try { return JSON.parse(localStorage.getItem(PUSH_KEY)) || {}; } catch { return {}; } };
const setPush = v => localStorage.setItem(PUSH_KEY, JSON.stringify({ ...pushCfg(), ...v }));
const pushUrl = () => (pushCfg().url || '').replace(/\/+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function enablePush() {
  if (!pushUrl()) throw new Error('Paste the push server address first.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Notifications only work from the Home Screen app (iOS 16.4 or later). Open Lift from its Home Screen icon.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are turned off for Lift. Turn them on in iPhone Settings → Notifications → Lift.');
  const res = await fetch(pushUrl() + '/key');
  if (!res.ok) throw new Error(`Push server error ${res.status}. Check the address.`);
  const { key } = await res.json();
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) });
  setPush({ sub: sub.toJSON(), on: true });
}
function pushPost(path, body) {
  return fetch(pushUrl() + path, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
// Hand the rest timer to the server when the app goes to the background; take it back on return.
function pushOnHide() {
  const c = pushCfg();
  const end = state.active?.timerEnd;
  if (!c.on || !c.sub || !end || end - Date.now() < 3000) return;
  pushPost('/schedule', { sub: c.sub, at: end }).catch(() => {});
  c.pending = true; setPush({ pending: true });
}
function pushOnShow() {
  const c = pushCfg();
  if (!c.on || !c.sub || !c.pending) return;
  setPush({ pending: false });
  pushPost('/cancel', { endpoint: c.sub.endpoint }).catch(() => {});
}
document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? pushOnHide() : pushOnShow()));
window.addEventListener('pagehide', pushOnHide);

// Live workout clock (elapsed since Start), always on screen during a workout.
const fmtClock = ms => { const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60; return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(sec).padStart(2, '0')}`; };
function tickClock() {
  const el = $('#clock');
  if (!state.active) { el.hidden = true; return; }
  el.hidden = false;
  const t = fmtClock(Date.now() - state.active.startedAt);
  el.textContent = '⏱ ' + t;
  const h = document.getElementById('elapsed');
  if (h) h.textContent = t;
}
setInterval(tickClock, 1000);

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (state.active) keepAwake(true); tickTimer(); }
});

// ================= shared components =================
function ratingCard(r, { title = 'Workout rating', compact = false } = {}) {
  const bar = (label, v, hint) => `
    <div class="metric">
      <div class="metric-top"><span>${label}</span><b>${v}</b></div>
      <div class="meter"><i style="width:${v}%"></i></div>
      ${compact ? '' : `<div class="hint">${hint}</div>`}
    </div>`;
  const muscles = r.perMuscle.map(p => {
    const [lo, hi] = p.target;
    const max = Math.max(hi * 1.3, p.sets);
    const status = p.sets < lo ? ['Low', 'st-low', '▼'] : p.sets > hi ? ['High', 'st-high', '▲'] : ['On target', 'st-ok', '●'];
    return `
      <div class="mrow">
        <span class="mname">${MUSCLES[p.m]}</span>
        <div class="mbar"><span class="band" style="left:${(lo / max) * 100}%;width:${((hi - lo) / max) * 100}%"></span><i style="width:${(p.sets / max) * 100}%"></i></div>
        <span class="mval">${p.sets}</span>
        <span class="mstat ${status[1]}">${status[2]} ${status[0]}</span>
      </div>`;
  }).join('');
  return `
  <section class="card rating">
    <div class="rating-head">
      <div class="grade ${gradeClass(r.grade)}">${r.grade}</div>
      <div>
        <div class="eyebrow">${title}</div>
        <div class="score">${r.overall}<small>/100</small></div>
        <div class="muted">~${r.minutes} min</div>
      </div>
    </div>
    ${bar('Muscle coverage', r.coverage, 'Effective sets per target muscle vs. a per-session range')}
    ${bar('Lengthened bias', r.lengthened, 'How much load lands at long muscle lengths')}
    ${bar('Stimulus / fatigue', r.sfr, 'Growth stimulus relative to systemic and joint cost')}
    ${muscles ? `<div class="mlist"><div class="eyebrow">Sets per muscle <span class="muted">(shaded = target range)</span></div>${muscles}</div>` : ''}
    ${!compact && r.notes.length ? `<ul class="notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

const ALL_SETS_TECH = new Set(['eccentric', 'pause', 'onehalf']);
const restText = s => (s.rest ? `${s.rest}s rest` : 'no rest, go to next');
// ---------- supersets and circuits ----------
// Consecutive slots whose group labels share a prefix ("A1", "A2" or "Abs 1", "Abs 2"...) form one block.
const groupKey = g => String(g || '').replace(/\s*\d+$/, '').trim();
const groupColor = k => (/^abs?$/i.test(k) ? 'g-abs' : `g-${(k.toUpperCase().charCodeAt(0) - 65) % 4}`);
function groupInfo(slots, i) {
  const k = groupKey(slots[i]?.group);
  if (!k) return null;
  let a = i, b = i;
  while (a > 0 && groupKey(slots[a - 1].group) === k) a--;
  while (b < slots.length - 1 && groupKey(slots[b + 1].group) === k) b++;
  if (a === b) return null; // a lone labeled slot is not a block
  const size = b - a + 1;
  const isAbs = /^abs?$/i.test(k);
  return {
    key: k, first: a, last: b, size, color: groupColor(k),
    circuit: size >= 3 || isAbs,
    name: isAbs ? 'Ab circuit' : size >= 3 ? `Circuit ${k}` : `Superset ${k}`,
    rounds: Math.max(...slots.slice(a, b + 1).map(x => x.sets || (x.log ? workSets(x.log).length : 0))),
    rest: slots[b].rest,
  };
}
const groupTag = s => (s.group ? `<span class="chip grp ${groupColor(groupKey(s.group))}">${esc(s.group)}</span> ` : '');
function groupHead(g, slots, tag = 'li') {
  if (!g) return '';
  const how = g.circuit
    ? `${g.size} exercises back to back · ${g.rounds} round${g.rounds > 1 ? 's' : ''} · ${g.rest ? `${g.rest}s` : 'no'} rest between rounds`
    : `Alternate ${slots[g.first].group} and ${slots[g.last].group} · rest ${g.rest ? `${g.rest}s` : 'none'} after ${slots[g.last].group}`;
  let prog = '';
  if (slots[g.first].log) {
    const done = Math.min(...slots.slice(g.first, g.last + 1).map(x => workSets(x.log).filter(y => y.done).length));
    prog = done >= g.rounds ? '<span class="grp-prog done">Done</span>' : `<span class="grp-prog">Round ${done + 1} of ${g.rounds}</span>`;
  }
  return `<${tag} class="grp-head ${g.color}"><div><b>${g.circuit ? '⟳' : '⇄'} ${esc(g.name)}</b>${prog}</div><span>${how}</span></${tag}>`;
}
const grpClass = (g, i) => (g ? `in-grp ${g.color} ${i === g.first ? 'grp-first' : ''} ${i === g.last ? 'grp-last' : ''}` : '');
// Technique and coaching cues carried over from an imported program.
function slotExtras(s) {
  const T = E.techOf(s.intensity?.t);
  const tech = s.tech ? `<div class="tech">◆ ${esc(s.tech)}</div>` : T ? `<div class="tech">◆ ${esc(T.label)} (${s.intensity.on === 'all' ? 'all sets' : s.intensity.on === 'first' ? 'first set' : 'last set'})</div>` : '';
  const note = s.note ? `<details class="cue"><summary>Cues</summary><p>${esc(s.note)}</p></details>` : '';
  return tech + note;
}

// Editable slot list used by Today preview, Build and Program editor.
function slotList(slots, where, { editable = true } = {}) {
  const L = lib();
  return `<ol class="slots">${slots.map((s, i) => {
    const ex = L[s.ex];
    if (!ex) return `<li class="slot missing"><div class="slot-main"><b>Unknown exercise: ${esc(s.ex)}</b></div>
      <div class="slot-actions"><button class="btn sm" data-act="swap" data-where="${where}" data-i="${i}">Choose</button><button class="btn sm ghost" data-act="remove-slot" data-where="${where}" data-i="${i}">Remove</button></div></li>`;
    const er = E.rateExercise(ex);
    const u = E.repLabel(ex);
    const sub = s.subbedFrom ? `<div class="subbed">↺ Swapped from ${esc(L[s.subbedFrom]?.name || s.subbedFrom)}</div>` : '';
    const miss = s.missing ? `<div class="subbed warn">No equipment match in this profile</div>` : '';
    const g = groupInfo(slots, i);
    return `${g && i === g.first ? groupHead(g, slots) : ''}<li class="slot ${grpClass(g, i)}">
      <div class="slot-main">
        <div class="slot-title">${groupTag(s)}<span class="chip ${gradeClass(er.grade)}">${er.grade}</span> <b>${esc(ex.name)}</b></div>
        <div class="slot-meta">
          ${editable ? `
          <span class="stepper"><button data-act="sets" data-d="-1" data-where="${where}" data-i="${i}" aria-label="Fewer sets">−</button>${s.sets} sets<button data-act="sets" data-d="1" data-where="${where}" data-i="${i}" aria-label="More sets">+</button></span>
          <span class="reps"><input inputmode="numeric" data-field="rlo" data-where="${where}" data-i="${i}" value="${s.reps[0]}">–<input inputmode="numeric" data-field="rhi" data-where="${where}" data-i="${i}" value="${s.reps[1]}"> ${esc(u)}</span>
          <span class="reps"><input inputmode="numeric" data-field="rest" data-where="${where}" data-i="${i}" value="${s.rest}">s rest</span>
          <label class="reps">Technique <select data-field="intensity" data-where="${where}" data-i="${i}">
            <option value="">None</option>
            ${Object.entries(E.TECHNIQUES).map(([k, T]) => `<option value="${k}" ${s.intensity?.t === k ? 'selected' : ''}>${esc(T.label)}${ALL_SETS_TECH.has(k) ? ' (all sets)' : ' (last set)'}</option>`).join('')}
          </select></label>`
          : `<span>${s.sets} × ${E.fmtRange(s.reps)} ${esc(u)}</span><span>${restText(s)}</span>`}
        </div>
        <div class="slot-tags">${esc(PATTERNS[ex.pattern] || ex.pattern)} · ${Object.entries(ex.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ')}</div>
        ${slotExtras(s)}
        ${editable && s.byCycle ? '<div class="subbed">This exercise changes by cycle. Edits apply to the cycle shown.</div>' : ''}
        ${sub}${miss}
      </div>
      <div class="slot-actions">
        <button class="btn sm" data-act="swap" data-where="${where}" data-i="${i}">Swap</button>
        <button class="btn sm" data-act="taken" data-where="${where}" data-i="${i}" title="Machine busy: auto-substitute">Taken</button>
        <button class="btn sm ghost" data-act="lift" data-ex="${ex.id}">History</button>
        <button class="btn sm ghost" data-act="video" data-ex="${ex.id}">Form</button>
        ${editable ? `<button class="icon" data-act="up" data-where="${where}" data-i="${i}" aria-label="Move up">↑</button>
        <button class="icon" data-act="remove-slot" data-where="${where}" data-i="${i}" aria-label="Remove">✕</button>` : ''}
      </div>
    </li>`;
  }).join('')}</ol>
  <button class="btn block ghost" data-act="add-ex" data-where="${where}">+ Add exercise</button>`;
}

function getSlots(where) {
  if (where === 'active') return state.active?.slots;
  if (where === 'preview') return ui.preview?.slots;
  if (where === 'build') return ui.build.slots;
  if (where.startsWith('day:')) return program().days[+where.slice(4)]?.slots;
  return null;
}
// In the program editor, a slot with per-cycle overrides is edited for the current cycle.
function editTarget(where, i, key) {
  const s = getSlots(where)[i];
  if (where.startsWith('day:') && s.byCycle) {
    const o = s.byCycle[currentWeek().idx];
    if (o && o[key] != null) return o;
  }
  return s;
}
function persistFor(where) {
  if (where === 'active' || where.startsWith('day:')) save({ sync: where !== 'active' });
}
function usedIds(where) { return new Set((getSlots(where) || []).map(s => s.ex)); }

// ================= views =================
function viewToday() {
  if (state.active) return viewActive();
  const p = program();
  const L = lib();
  if (catchUpRest(p)) { ui.preview = null; save(); }
  const rot = (state.rotation[p.id] || 0) % p.days.length;
  const dayIdx = ui.previewDay != null ? p.days.findIndex(d => d.id === ui.previewDay) : rot;
  const day = p.days[dayIdx] || p.days[0];
  const week = currentWeek();
  // Programs with rest days in their rotation ignore the weekday rest-day setting.
  const programRest = E.isRestDay(day) && ui.previewDay == null;
  const weekdayRest = !hasRestDays(p) && state.settings.restDays.includes(new Date().getDay()) && ui.previewDay == null;
  const isRest = programRest || weekdayRest;
  const doneToday = state.sessions.filter(s => s.date === todayISO());
  // Next training day after a rest day, for the "train anyway" button.
  let nextTrain = day;
  if (E.isRestDay(day)) { let k = dayIdx; for (let g = 0; g < p.days.length && E.isRestDay(p.days[k]); g++) k = nextIdx(p, k); nextTrain = p.days[k]; }

  if (!E.isRestDay(day) && (!ui.preview || ui.preview.dayId !== day.id || ui.preview.profile !== state.settings.activeProfile || ui.preview.programId !== p.id || ui.preview.cycle !== week.idx)) {
    ui.preview = { dayId: day.id, programId: p.id, profile: state.settings.activeProfile, cycle: week.idx, slots: E.resolveSlots(daySlots(day, week), L, ctx()) };
  }
  const r = E.isRestDay(day) ? null : E.rateSession(ui.preview.slots, L, focusMuscles(day));
  const subs = r ? ui.preview.slots.filter(s => s.subbedFrom).length : 0;
  const pos = hasRestDays(p) || p.cycles?.length ? `Day ${dayIdx + 1} of ${p.days.length}` : '';

  return `
  <header class="page-head">
    <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
    <h1>${isRest ? (programRest ? esc(day.name) : 'Rest day') : esc(day.name)}</h1>
    <div class="head-meta">
      <span class="pill">${esc(p.name)}</span>
      <span class="pill ${week.deload ? 'pill-warn' : ''}">${esc(week.label)}</span>
      ${pos ? `<span class="pill">${pos}</span>` : ''}
      <button class="pill pill-btn" data-act="sheet-profile">⚙ ${esc(profile().name)}</button>
    </div>
  </header>
  ${doneToday.length ? `<div class="banner ok">✓ Logged today: ${doneToday.map(s => esc(s.name)).join(', ')}</div>` : ''}
  ${week.done ? `<div class="banner ok">✓ All ${week.total} cycles of this program are complete. Showing the last cycle.</div>` : ''}
  ${isRest ? `<div class="card"><p>${programRest ? 'Rest day in the program rotation.' : 'Today is a scheduled rest day.'} Next training day is <b>${esc(nextTrain.name)}</b>.</p>
    <div class="row-btns">
      ${programRest ? `<button class="btn primary" data-act="rest-done" data-i="${dayIdx}">Rest done, move to next day</button>` : ''}
      <button class="btn" data-act="pick-day" data-id="${nextTrain.id}">Train ${esc(nextTrain.name)} today</button>
    </div>
    ${programRest ? '<p class="muted small">Rest days pass on their own: tomorrow moves to the next day unless you train today.</p>' : ''}</div>` : `
  ${subs ? `<div class="banner">↺ ${subs} exercise${subs > 1 ? 's' : ''} auto-substituted for ${esc(profile().name)}</div>` : ''}
  ${ratingCard(r)}
  <section class="card">
    <div class="card-head"><h2>Exercises</h2><span class="muted">${ui.preview.slots.reduce((a, s) => a + (week.deload && !week.custom ? Math.ceil(s.sets / 2) : s.sets), 0)} sets · ${esc(effortText(week))}</span></div>
    ${slotList(ui.preview.slots, 'preview', { editable: false })}
  </section>
  <button class="btn primary block big" data-act="start">Start workout</button>`}
  <section class="card">
    <div class="card-head"><h2>Pick a different day</h2></div>
    <div class="chips">${p.days.map((d, i) => E.isRestDay(d) ? '' : `<button class="chip-btn ${d.id === day.id && !isRest ? 'on' : ''}" data-act="pick-day" data-id="${d.id}">${esc(d.name)}${i === rot ? ' ·next' : ''}</button>`).join('')}</div>
  </section>`;
}

function viewActive() {
  const a = state.active;
  const L = lib();
  const week = currentWeek(a.programId);
  const r = E.rateSession(a.slots.map(s => ({ ...s, sets: workSets(s.log).length })), L, a.focus);
  const doneSets = a.slots.reduce((n, s) => n + workSets(s.log).filter(x => x.done).length, 0);
  const totalSets = a.slots.reduce((n, s) => n + workSets(s.log).length, 0);

  const cards = a.slots.map((s, i) => {
    const ex = L[s.ex];
    if (!ex) return '';
    const er = E.rateExercise(ex);
    const u = E.repLabel(ex);
    const workW = s.log.find(x => !x.warm && !x.sub && x.w !== '' && x.w != null)?.w || s.suggest?.weight;
    const wu = E.warmups(ex, +workW);
    const allDone = s.log.length && s.log.every(x => x.done);
    let n = 0;
    const g = groupInfo(a.slots, i);
    return `${g && i === g.first ? groupHead(g, a.slots, 'div') : ''}
    <section class="card ex-card ${allDone ? 'done' : ''} ${grpClass(g, i)}" id="ex-${i}">
      <div class="ex-head">
        <div>
          <div class="slot-title">${groupTag(s)}<span class="chip ${gradeClass(er.grade)}">${er.grade}</span> <b>${esc(ex.name)}</b></div>
          <div class="muted">${E.fmtRange(s.reps)} ${esc(u)} · <button class="rest-btn" data-act="rest-edit" data-i="${i}" aria-label="Change rest time">⏱ ${restText(s)}</button> · ${esc(effortText(week))}</div>
          ${slotExtras(s)}
          ${s.subbedFrom ? `<div class="subbed">↺ Swapped from ${esc(L[s.subbedFrom]?.name || s.subbedFrom)}</div>` : ''}
        </div>
        <button class="icon" data-act="ex-menu" data-i="${i}" aria-label="Exercise options">⋯</button>
      </div>
      ${s.suggest?.note ? `<div class="suggest">↗ ${esc(s.suggest.note)}</div>` : ''}
      ${wu.length ? `<div class="warmup"><span>Warm-up</span>${wu.map(w => `<b>${fmtW(w.w)}×${w.r}</b>`).join('')}</div>` : ''}
      <div class="sets">
        <div class="set-row head"><span>Set</span><span>${unit()}</span><span>${esc(u[0].toUpperCase() + u.slice(1))}</span><span></span></div>
        ${s.log.map((x, j) => {
          const T = E.techOf(x.sub || x.t);
          const label = x.sub ? `<span class="set-n sub" title="${esc(T?.label || '')}">${esc(T?.short || x.sub)}</span>`
            : x.warm ? `<button class="set-n tap warm" data-act="set-tech" data-i="${i}" data-j="${j}" aria-label="Warm-up set options">W</button>`
            : `<button class="set-n tap ${x.t ? 'has-t' : ''}" data-act="set-tech" data-i="${i}" data-j="${j}" aria-label="Set ${n + 1} options">${++n}</button>`;
          const wIdx = x.warm ? s.log.slice(0, j).filter(y => y.warm).length : -1;
          const rph = x.sub ? (T?.reps ?? '') : x.warm ? (wu[wIdx]?.r ?? '') : (s.suggest?.reps ?? '');
          return `
        <div class="set-row ${x.done ? 'is-done' : ''} ${x.sub ? 'sub-row' : ''} ${x.warm ? 'warm-row' : ''}">
          ${label}
          <input inputmode="decimal" data-field="w" data-i="${i}" data-j="${j}" value="${x.w ?? ''}" placeholder="${x.sub ? '' : x.warm ? (wu[wIdx]?.w ?? '') : s.suggest?.weight ?? '—'}">
          <input inputmode="numeric" data-field="r" data-i="${i}" data-j="${j}" value="${x.r ?? ''}" placeholder="${rph}">
          <button class="check ${x.done ? 'on' : ''}" data-act="done" data-i="${i}" data-j="${j}" aria-label="Complete set">✓</button>
        </div>${!x.sub && T ? `<div class="set-tech"><span class="chip grp">${esc(T.short)}</span> <span class="muted">${esc(x.t === 'drop' ? `Strip ~${x.pct || T.pct}% and go again, no rest` : T.desc)}</span></div>` : ''}`;
        }).join('')}
      </div>
      <p class="muted small set-hint">Tap a set number to make it a warm-up or add a drop set, myo-reps, rest-pause and more.</p>
      <div class="row-btns">
        <button class="btn sm ghost" data-act="lift" data-ex="${s.ex}" data-i="${i}">History · % 1RM</button>
        <button class="btn sm ghost" data-act="add-warm" data-i="${i}">+ Warm-up</button>
        <button class="btn sm ghost" data-act="add-set" data-i="${i}">+ Set</button>
        <button class="btn sm ghost" data-act="del-set" data-i="${i}">− Set</button>
        <button class="btn sm" data-act="taken" data-where="active" data-i="${i}">Taken</button>
        <button class="btn sm" data-act="swap" data-where="active" data-i="${i}">Swap</button>
      </div>
    </section>`;
  }).join('');

  return `
  <header class="page-head">
    <div class="eyebrow">In progress · <span id="elapsed">${fmtClock(Date.now() - a.startedAt)}</span> · ${doneSets}/${totalSets} sets</div>
    <h1>${esc(a.name)}</h1>
    <div class="head-meta"><span class="pill ${week.deload ? 'pill-warn' : ''}">${esc(week.label)}</span><span class="pill">${esc(state.profiles[a.profile]?.name || '')}</span></div>
    <div class="progress"><i style="width:${totalSets ? (doneSets / totalSets) * 100 : 0}%"></i></div>
  </header>
  <button class="btn block ghost sm" data-act="toggle-rating">${ui.showRating ? 'Hide' : 'Show'} rating · ${r.grade} (${r.overall})</button>
  ${ui.showRating ? ratingCard(r, { compact: true }) : ''}
  ${cards}
  <button class="btn block ghost" data-act="add-ex" data-where="active">+ Add exercise</button>
  <button class="btn primary block big" data-act="finish">Finish workout</button>
  <button class="btn block danger-ghost" data-act="discard">Discard workout</button>`;
}

function viewBuild() {
  const b = ui.build;
  const L = lib();
  const r = b.slots ? E.rateSession(b.slots, L, b.muscles) : null;
  return `
  <header class="page-head"><div class="eyebrow">Curate on the fly</div><h1>Build a workout</h1>
    <div class="head-meta"><button class="pill pill-btn" data-act="sheet-profile">⚙ ${esc(profile().name)}</button></div></header>
  <section class="card">
    <div class="eyebrow">Focus</div>
    <div class="chips">${Object.entries(E.FOCUS_LABEL).map(([k, v]) => `<button class="chip-btn ${b.focus === k ? 'on' : ''}" data-act="b-focus" data-k="${k}">${v}</button>`).join('')}</div>
    <div class="eyebrow mt">Target muscles</div>
    <div class="chips">${Object.entries(MUSCLES).filter(([m]) => m !== 'lower_back').map(([m, n]) => `<button class="chip-btn ${b.muscles.includes(m) ? 'on' : ''}" data-act="b-muscle" data-m="${m}">${n}</button>`).join('')}</div>
    <div class="eyebrow mt">Time cap</div>
    <div class="chips">${[30, 45, 60, 75, 90].map(m => `<button class="chip-btn ${b.minutes === m ? 'on' : ''}" data-act="b-min" data-m="${m}">${m} min</button>`).join('')}</div>
    <button class="btn primary block mt" data-act="b-gen">${b.slots ? 'Regenerate' : 'Generate workout'}</button>
  </section>
  ${b.slots ? `
    ${ratingCard(r)}
    <section class="card"><div class="card-head"><h2>Exercises</h2></div>${slotList(b.slots, 'build')}</section>
    <button class="btn primary block big" data-act="b-start">Start this workout</button>
    <button class="btn block" data-act="b-save">Save as a day in “${esc(program().name)}”</button>` : ''}`;
}

function weekChart(rows) {
  const max = Math.max(26, ...rows.map(r => r.sets));
  return rows.map(r => {
    const [lo, hi] = r.target;
    const st = r.sets < lo ? ['▼ Low', 'st-low'] : r.sets > hi ? ['▲ High', 'st-high'] : ['● OK', 'st-ok'];
    return `<div class="mrow" title="${MUSCLES[r.m]}: ${r.sets} sets/week (target ${lo}–${hi})">
      <span class="mname">${MUSCLES[r.m]}</span>
      <div class="mbar"><span class="band" style="left:${(lo / max) * 100}%;width:${((hi - lo) / max) * 100}%"></span><i style="width:${(r.sets / max) * 100}%"></i></div>
      <span class="mval">${r.sets}</span><span class="mstat ${st[1]}">${st[0]}</span></div>`;
  }).join('');
}

function viewProgram() {
  const p = program();
  const L = lib();
  const week = currentWeek();
  const resolved = p.days.map(d => E.resolveSlots(daySlots(d, week), L, ctx()));
  // A rotation longer or shorter than 7 days is scaled to sets per 7 days.
  const scale = hasRestDays(p) ? 7 / p.days.length : 1;
  const wk = E.rateWeek(resolved, L, scale);
  const rot = (state.rotation[p.id] || 0) % p.days.length;
  const cycles = E.cyclesOf(p);
  return `
  <header class="page-head"><div class="eyebrow">Program</div><h1>${esc(p.name)}</h1>
    <div class="head-meta">
      <select class="pill" data-field="program-select">${Object.values(state.programs).map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span class="pill">${esc(week.label)}</span>
    </div></header>
  ${p.cycles?.length || hasRestDays(p) ? `<section class="card">
    <div class="card-head"><h2>Schedule</h2><span class="muted">${p.days.length}-day rotation${p.cycles?.length ? ` · ${p.cycles.length} cycles` : ''}</span></div>
    <p class="muted small">The next workout only moves forward when you finish one. Miss a day and the same workout is waiting when you come back. Rest days pass on their own after a day without training.</p>
    ${p.cycles?.length ? `<label class="field">Current cycle <select data-field="cycle-select">${p.cycles.map((c, i) => `<option value="${i}" ${i === week.idx ? 'selected' : ''}>${esc(c.label || `Cycle ${i + 1}`)}</option>`).join('')}</select></label>` : ''}
    ${p.cycles?.length ? `<div class="eyebrow mt">Cycles</div><ol class="cycle-list">${p.cycles.map((c, i) => `<li class="${i === week.idx ? 'on' : ''} ${c.deload ? 'deload' : ''}">${esc(c.label || `Cycle ${i + 1}`)}${c.effort ? ` <span class="muted">· ${esc(c.effort)}</span>` : ''}</li>`).join('')}</ol>` : ''}
  </section>` : ''}
  <section class="card rating">
    <div class="rating-head"><div class="grade ${gradeClass(wk.grade)}">${wk.grade}</div>
      <div><div class="eyebrow">Weekly volume rating</div><div class="score">${wk.score}<small>/100</small></div><div class="muted">With ${esc(profile().name)} equipment${scale !== 1 ? ` · ${p.days.length}-day cycle scaled to 7 days` : ''}${cycles !== E.MESO ? ` · ${esc(week.label)}` : ''}</div></div></div>
    <div class="mlist"><div class="eyebrow">Hard sets per muscle per week <span class="muted">(shaded = target range)</span></div>${weekChart(wk.rows)}</div>
  </section>
  ${p.days.map((d, i) => {
    const open = ui.editDay === i;
    if (E.isRestDay(d)) return `<section class="card day rest-day">
      <div class="day-head static"><span class="grade sm rest">—</span><span class="day-name"><b>${esc(d.name)}</b><span class="muted">Rest${i === rot ? ' · next up' : ''}</span></span>
      <button class="icon" data-act="del-day" data-i="${i}" aria-label="Remove rest day">✕</button></div></section>`;
    const r = E.rateSession(resolved[i], L, focusMuscles(d));
    return `<section class="card day ${open ? 'open' : ''}">
      <button class="day-head" data-act="edit-day" data-i="${i}">
        <span class="grade sm ${gradeClass(r.grade)}">${r.grade}</span>
        <span class="day-name"><b>${esc(d.name)}</b><span class="muted">${d.slots.length} exercises · ~${r.minutes} min${i === rot ? ' · next up' : ''}</span></span>
        <span class="chev">${open ? '▾' : '▸'}</span>
      </button>
      ${open ? `
        <div class="day-edit">
          <label class="field">Name <input data-field="day-name" data-i="${i}" value="${esc(d.name)}"></label>
          <label class="field">Focus <select data-field="day-focus" data-i="${i}">${Object.entries(E.FOCUS_LABEL).map(([k, v]) => `<option value="${k}" ${d.focus === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${slotList(d.slots.map(s => (s.byCycle ? E.slotFor(s, week.idx) : s)), 'day:' + i)}
          <div class="row-btns">
            <button class="btn sm" data-act="set-next" data-i="${i}">Make next up</button>
            <button class="btn sm" data-act="day-up" data-i="${i}">Move up</button>
            <button class="btn sm danger-ghost" data-act="del-day" data-i="${i}">Delete day</button>
          </div>
        </div>` : ''}
    </section>`;
  }).join('')}
  <div class="row-btns"><button class="btn block ghost" data-act="add-day">+ Add day</button><button class="btn block ghost" data-act="add-rest">+ Add rest day</button></div>
  <section class="card">
    <div class="card-head"><h2>Programs</h2></div>
    <ul class="prog-list">${Object.values(state.programs).map(x => {
      const w = currentWeek(x.id);
      const r = (state.rotation[x.id] || 0) % x.days.length;
      return `<li class="${x.id === p.id ? 'on' : ''}">
        <div class="day-name"><b>${esc(x.name)}</b><span class="muted">${x.id === p.id ? 'Active · ' : ''}Next: ${esc(x.days[r]?.name || '')}${x.cycles?.length ? ` · ${esc(w.label)}` : ''}</span></div>
        <div class="row-btns tight">
          ${x.id === p.id ? '' : `<button class="btn sm" data-act="prog-use" data-id="${x.id}">Use</button>`}
          <button class="btn sm" data-act="sheet-import" data-id="${x.id}">Update</button>
          <button class="btn sm danger-ghost" data-act="prog-del" data-id="${x.id}">Delete</button>
        </div></li>`;
    }).join('')}</ul>
    <div class="row-btns">
      <button class="btn sm" data-act="sheet-import">Import new</button>
      <button class="btn sm" data-act="prog-export">Export active</button>
      <button class="btn sm" data-act="prog-new">New blank</button>
      <button class="btn sm" data-act="prog-dup">Duplicate</button>
      <button class="btn sm" data-act="prog-rename">Rename</button>
    </div>
    <p class="muted small"><b>Update</b> swaps in new program code but keeps your place, your current cycle and your lift history. Importing a program with the same name as one you have updates it automatically.</p>
  </section>`;
}

function lineChart(points) {
  // points: [{x: label, y: number}]
  if (points.length < 2) return '<p class="muted">Log this lift at least twice to see a trend.</p>';
  const W = 340, H = 170, pl = 40, pr = 12, pt = 14, pb = 26;
  const ys = points.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max(5, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const x = i => pl + (i / (points.length - 1)) * (W - pl - pr);
  const y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad].map(v => Math.round(v));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one-rep max over time">
    ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${pl - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${t}</text>`).join('')}
    <text x="${pl}" y="${H - 6}" class="axis">${esc(points[0].x)}</text>
    <text x="${W - pr}" y="${H - 6}" class="axis" text-anchor="end">${esc(points[points.length - 1].x)}</text>
    <path d="${path}" class="line"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="4" class="dot"/><circle cx="${x(i)}" cy="${y(p.y)}" r="14" class="hit" data-act="pt" data-label="${esc(p.x)}: ${p.timed ? 'best ' + Math.round(p.y) : `e1RM ${Math.round(p.y)} ${unit()}`}${p.best ? ' (' + esc(p.best) + ')' : ''}"/>`).join('')}
  </svg><div class="chart-tip" id="chart-tip">Tap a point for details</div>`;
}

function viewProgress() {
  const L = lib();
  ui.progressUnit = null;
  const logged = new Map();
  state.sessions.forEach(s => s.slots.forEach(sl => { if (sl.log.some(x => x.done)) logged.set(sl.ex, (logged.get(sl.ex) || 0) + 1); }));
  const exIds = [...logged.keys()].filter(id => L[id]).sort((a, b) => L[a].name.localeCompare(L[b].name));
  if (!ui.progressEx || !logged.has(ui.progressEx)) ui.progressEx = exIds[0] || null;

  const weekAgo = Date.now() - 7 * 864e5;
  const recent = state.sessions.filter(s => s.finishedAt > weekAgo);
  const weekSets = recent.reduce((n, s) => n + s.slots.reduce((m, sl) => m + sl.log.filter(x => x.done && !x.sub && !x.warm).length, 0), 0);

  let chart = '<p class="muted">Finish a workout to start tracking progress.</p>', table = '';
  if (ui.progressEx) {
    const h = history(ui.progressEx).reverse();
    const u = E.repUnit(L[ui.progressEx]);
    const timed = u !== 'reps';
    const pts = h.map(e => {
      // Holds, carries and passes: chart the best count instead of an estimated 1RM.
      const best = timed ? e.sets.reduce((b, s) => (s.r > b.r ? s : b), e.sets[0]) : e.sets.reduce((b, s) => (E.e1rm(s.w, s.r) > E.e1rm(b.w, b.r) ? s : b), e.sets[0]);
      return { x: new Date(e.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), y: timed ? best.r : E.e1rm(best.w, best.r), best: `${fmtW(best.w)}×${best.r}`, timed };
    }).filter(p => p.y > 0);
    ui.progressUnit = timed ? u : null;
    chart = lineChart(pts);
    table = `<table class="tbl"><thead><tr><th>Date</th><th>Sets (${unit()} × ${esc(u)})</th></tr></thead><tbody>
      ${h.slice().reverse().slice(0, 12).map(e => `<tr><td>${esc(e.date)}</td><td>${e.sets.map(s => `${fmtW(s.w)}×${s.r}`).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  }

  return `
  <header class="page-head"><div class="eyebrow">Progress</div><h1>History</h1></header>
  <div class="stats">
    <div class="stat"><b>${recent.length}</b><span>workouts, 7 days</span></div>
    <div class="stat"><b>${weekSets}</b><span>hard sets, 7 days</span></div>
    <div class="stat"><b>${state.sessions.length}</b><span>total workouts</span></div>
  </div>
  <section class="card">
    <div class="card-head"><h2>Lift trend</h2></div>
    ${exIds.length ? `<select class="full" data-field="progress-ex">${exIds.map(id => `<option value="${id}" ${id === ui.progressEx ? 'selected' : ''}>${esc(L[id].name)}</option>`).join('')}</select>` : ''}
    <div class="eyebrow mt">${ui.progressUnit ? `Best set (${esc(ui.progressUnit)})` : `Estimated 1-rep max (${unit()})`}</div>
    ${chart}
    ${table}
  </section>
  <section class="card">
    <div class="card-head"><h2>Recent workouts</h2></div>
    ${state.sessions.slice().reverse().slice(0, 20).map(s => `
      <div class="hist-row">
        <span class="grade sm ${gradeClass(s.rating?.grade || 'D')}">${s.rating?.grade || '–'}</span>
        <div class="day-name"><b>${esc(s.name)}</b><span class="muted">${esc(s.date)} · ${s.minutes ?? '?'} min · ${s.slots.reduce((n, sl) => n + sl.log.filter(x => x.done && !x.sub && !x.warm).length, 0)} sets</span></div>
        <button class="icon" data-act="del-session" data-id="${s.id}" aria-label="Delete workout">✕</button>
      </div>`).join('') || '<p class="muted">No workouts yet.</p>'}
  </section>`;
}

function viewSettings() {
  const g = gist();
  const pf = profile();
  const groups = {
    'Free weights': ['barbell', 'rack', 'dumbbell', 'ez_bar', 'bench', 'incline_bench', 'preacher', 'band'],
    'Bodyweight stations': ['pullup_bar', 'dip_station', 'assisted_pullup', 'back_extension'],
    'Cables': ['cable', 'lat_pulldown', 'cable_row'],
    'Machines': ['smith', 'leg_press', 'hack_squat', 'pendulum', 'leg_ext', 'seated_leg_curl', 'lying_leg_curl', 'pec_deck', 'chest_press_machine', 'shoulder_press_machine', 'lateral_raise_machine', 'chest_supported_row', 'calf_machine', 'hip_adductor', 'hip_abductor'],
  };
  const st = syncStatus;
  return `
  <header class="page-head"><div class="eyebrow">Settings</div><h1>Setup</h1></header>
  <section class="card">
    <div class="card-head"><h2>Equipment profiles</h2></div>
    <div class="chips">${Object.entries(state.profiles).map(([id, p]) => `<button class="chip-btn ${id === state.settings.activeProfile ? 'on' : ''}" data-act="profile" data-id="${id}">${esc(p.name)}</button>`).join('')}
      <button class="chip-btn" data-act="profile-new">+ New</button></div>
    <label class="field mt">Profile name <input data-field="profile-name" value="${esc(pf.name)}"></label>
    ${Object.entries(groups).map(([gname, ids]) => `
      <div class="eyebrow mt">${gname}</div>
      <div class="checks">${ids.map(id => `<label class="check-item"><input type="checkbox" data-field="equip" data-id="${id}" ${pf.equip.includes(id) ? 'checked' : ''}><span>${EQUIPMENT[id]}</span></label>`).join('')}</div>`).join('')}
    <div class="row-btns mt">
      <button class="btn sm" data-act="equip-all">Select all</button>
      <button class="btn sm" data-act="equip-none">Clear</button>
      ${Object.keys(state.profiles).length > 1 ? '<button class="btn sm danger-ghost" data-act="profile-del">Delete profile</button>' : ''}
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Training</h2></div>
    <div class="eyebrow">Rest days</div>
    ${hasRestDays(program()) ? '<p class="muted small">The active program has rest days built into its rotation, so these weekday rest days are ignored for it.</p>' : ''}
    <div class="chips">${DAYS.map((d, i) => `<button class="chip-btn ${state.settings.restDays.includes(i) ? 'on' : ''}" data-act="restday" data-d="${i}">${d}</button>`).join('')}</div>
    <div class="eyebrow mt">Training block</div>
    ${program().cycles?.length ? `<p class="muted small">“${esc(program().name)}” sets its own cycles. Change the current cycle under Program → Schedule.</p><p>Currently: <b>${esc(currentWeek().label)}</b></p>` : `
    <p class="muted small">5-week blocks: RIR 3 → 2 → 1 → 0–1, then a deload week. Weeks advance as you complete each program rotation.</p>
    <p>Currently: <b>${currentWeek().label}</b></p>
    <button class="btn sm" data-act="new-block">Start a new block (back to week 1)</button>`}
    <div class="eyebrow mt">Units</div>
    <div class="chips">${['lb', 'kg'].map(u => `<button class="chip-btn ${unit() === u ? 'on' : ''}" data-act="unit" data-u="${u}">${u}</button>`).join('')}</div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Sync (private GitHub Gist)</h2><span class="sync-dot s-${st.state}">${st.state === 'ok' ? 'Synced' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Error' : g.token ? 'Ready' : 'Off'}</span></div>
    <p class="muted small">Create a token at github.com → Settings → Developer settings → Personal access tokens → <b>Tokens (classic)</b>, with only the <b>gist</b> scope. The token stays on this device and is never uploaded.</p>
    <label class="field">Token <input type="password" autocomplete="off" data-field="gist-token" value="${esc(g.token || '')}" placeholder="ghp_…"></label>
    <label class="field">Gist ID <input data-field="gist-id" value="${esc(g.id || '')}" placeholder="Created or found automatically"></label>
    ${st.state === 'error' ? `<div class="banner warn">${esc(st.msg)}</div>` : ''}
    <div class="row-btns"><button class="btn sm primary" data-act="sync">Sync now</button><button class="btn sm danger-ghost" data-act="gist-clear">Disconnect</button></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Rest notifications</h2><span class="sync-dot s-${pushCfg().on ? 'ok' : 'off'}">${pushCfg().on ? 'On' : 'Off'}</span></div>
    <p class="muted small">Sends a lock-screen notification when your rest is over while Lift is in the background or the phone is locked. Needs the push server from the README and the Home Screen app.</p>
    <label class="field">Push server address <input autocomplete="off" inputmode="url" data-field="push-url" value="${esc(pushCfg().url || '')}" placeholder="https://lift-push.yourname.workers.dev"></label>
    <div class="row-btns">
      <button class="btn sm primary" data-act="push-enable">${pushCfg().on ? 'Re-enable' : 'Enable notifications'}</button>
      ${pushCfg().on ? '<button class="btn sm" data-act="push-test">Send a test in 10 sec</button><button class="btn sm danger-ghost" data-act="push-off">Turn off</button>' : ''}
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h2>Dropbox</h2><span class="sync-dot s-${dropbox().refresh ? (st.state === 'error' ? 'error' : 'ok') : 'off'}">${dropbox().refresh ? 'Connected' : 'Off'}</span></div>
    <p class="muted small">Saves your data to Dropbox → Apps → (your app name) every time it changes, plus one dated backup per day in a <b>backups</b> folder. Exports can be saved there too. Works alongside the Gist or on its own.</p>
    ${dropbox().error ? `<div class="banner warn">${esc(dropbox().error)}</div>` : ''}
    ${dropbox().refresh ? `<p class="muted small">${dropbox().at ? `Last saved ${new Date(dropbox().at).toLocaleString()}.` : 'Not saved yet. Tap Sync now.'}</p>
    <div class="row-btns"><button class="btn sm primary" data-act="sync">Sync now</button><button class="btn sm danger-ghost" data-act="dropbox-clear">Disconnect</button></div>` : `
    <details class="cue"><summary>One-time setup (about 2 minutes)</summary><ol class="small">
      <li>Go to <b>dropbox.com/developers/apps</b> → <b>Create app</b>.</li>
      <li>Pick <b>Scoped access</b> and <b>App folder</b>. Name it anything unique.</li>
      <li><b>Permissions</b> tab: tick <b>files.content.write</b> and <b>files.content.read</b>, then Submit.</li>
      <li>Copy the <b>App key</b> from the Settings tab and paste it below. No redirect URI is needed.</li></ol></details>
    <label class="field">App key <input autocomplete="off" data-field="dropbox-key" value="${esc(dropbox().appKey || '')}" placeholder="From the Dropbox App Console"></label>
    <button class="btn sm primary" data-act="dropbox-connect">1. Get code from Dropbox</button>
    <label class="field mt">Code <input autocomplete="off" data-field="dropbox-code" placeholder="Paste the code Dropbox shows you"></label>
    <button class="btn sm primary" data-act="dropbox-finish">2. Finish connecting</button>`}
  </section>
  <p class="muted small center">App version ${esc(appVersion.replace('lift-', '') || '?')}</p>
  <section class="card">
    <div class="card-head"><h2>Data</h2></div>
    <div class="row-btns">
      <button class="btn sm" data-act="backup">Export backup</button>
      <button class="btn sm" data-act="sheet-import">Import program or backup</button>
      <button class="btn sm danger-ghost" data-act="reset">Reset app</button>
    </div>
    <p class="muted small">Add to Home Screen: open in Safari → Share → Add to Home Screen.</p>
  </section>`;
}

// ================= sheets (modals) =================
function sheetHTML() {
  const sh = ui.sheet;
  if (!sh) return '';
  const L = lib();
  let body = '';
  if (sh.type === 'swap' || sh.type === 'add') {
    const cur = sh.type === 'swap' ? (getSlots(sh.where) || [])[sh.i] : null;
    const orig = cur?.subbedFrom && L[cur.subbedFrom];
    body = `
      <h2>${sh.type === 'swap' ? `Swap ${esc(L[cur?.ex]?.name || '')}` : 'Add exercise'}</h2>
      ${orig ? `<button class="btn block primary" data-act="pick-ex" data-id="${orig.id}">↺ Back to original: ${esc(orig.name)}</button>` : ''}
      <div class="pick-search">
        <input class="full" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search all exercises by name or muscle" data-field="sheet-q" value="${esc(sh.q || '')}">
        <label class="check-item inline"><input type="checkbox" data-field="sheet-all" ${sh.all ? 'checked' : ''}><span>Include equipment not in this profile</span></label>
      </div>
      <ul class="pick" id="pick-list">${pickListHTML(sh)}</ul>`;
  } else if (sh.type === 'video') {
    const ex = L[sh.id];
    body = `<h2>${esc(ex.name)}</h2>
      <p class="muted">Primary: ${Object.entries(ex.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ')} · Stretch bias ${ex.len}/5 · SFR ${ex.sfr}/5</p>
      ${videoLinks(ex.name).map(([n, u]) => `<a class="btn block" href="${u}" target="_blank" rel="noopener">▶ ${n} form videos</a>`).join('')}`;
  } else if (sh.type === 'profile') {
    body = `<h2>Where are you training?</h2>
      ${Object.entries(state.profiles).map(([id, p]) => `<button class="btn block ${id === state.settings.activeProfile ? 'primary' : ''}" data-act="profile" data-id="${id}" data-close="1">${esc(p.name)} <span class="muted">· ${p.equip.length} items</span></button>`).join('')}
      <button class="btn block ghost" data-act="go-settings">Edit equipment</button>`;
  } else if (sh.type === 'lift') {
    const ex = L[sh.ex];
    const st = liftStats(sh.ex);
    const timed = E.repUnit(ex) !== 'reps';
    const target = sh.i != null && state.active?.slots[sh.i]?.log[sh.j] ? sh.j : null;
    const setNo = target != null ? workSets(state.active.slots[sh.i].log.slice(0, target + 1)).length : 0;
    const u = unit();
    body = `<h2>${esc(ex?.name || '')}</h2>
      ${!timed && st.e1rm ? `
      <div class="lift-stats">
        <div><span>Estimated 1RM</span><b>${fmtW(roundLoad(st.e1rm))} ${u}</b><small>from ${fmtW(st.from.w)}×${st.from.r} ${fmtDate(st.fromDate)}</small></div>
        <div><span>Best ever</span><b>${fmtW(roundLoad(st.best))} ${u}</b><small>${fmtW(st.bestFrom.w)}×${st.bestFrom.r}</small></div>
      </div>
      ${target != null ? `<p class="muted small">Tap a row to put that weight in <b>set ${setNo}</b> and the sets after it. Rounded to the nearest ${loadStep()} ${u}.</p>` : `<p class="muted small">Weights rounded to the nearest ${loadStep()} ${u}. Rep counts are what that load should allow to failure.</p>`}
      <div class="pct-table">
        <div class="pct-row head"><span>% 1RM</span><span>${u}</span><span>~Max reps</span></div>
        ${PCTS.map(p => { const w = roundLoad(st.e1rm * p / 100); return `<button class="pct-row" ${target != null ? `data-act="pct-apply" data-w="${w}"` : 'disabled'}><span>${p}%</span><b>${fmtW(w)}</b><span>${repsAt(p)}</span></button>`; }).join('')}
      </div>
      <div class="pct-custom"><input inputmode="decimal" data-field="pct-custom" value="${esc(sh.pct ?? '')}" placeholder="Other %"><span>% = <b id="pct-out">${sh.pct ? fmtW(roundLoad(st.e1rm * sh.pct / 100)) + ' ' + u : '—'}</b></span>${target != null ? '<button class="btn sm primary" data-act="pct-apply" data-custom="1">Use</button>' : ''}</div>`
      : `<p class="muted">${timed ? 'This exercise is timed, so there is no 1RM. History is below.' : 'No weighted sets logged yet. Finish a set with weight and reps and the estimate appears here.'}</p>`}
      <div class="eyebrow mt">History</div>
      ${st.today.length ? `<div class="hist-row"><span>Today</span><span>${st.today.map(x => `${fmtW(x.w)}×${x.r}`).join(', ')}</span></div>` : ''}
      ${st.hist.length ? st.hist.slice(0, 10).map(h => { const b = bestSet(h.sets); return `<div class="hist-row"><span>${fmtDate(h.date)}</span><span>${h.sets.map(x => `${x.w == null ? 'BW' : fmtW(x.w)}×${x.r}`).join(', ')}</span>${b && !timed ? `<small>e1RM ${fmtW(roundLoad(E.e1rm(b.w, b.r)))}</small>` : ''}</div>`; }).join('') : (st.today.length ? '' : '<p class="muted small">Not done yet.</p>')}`;
  } else if (sh.type === 'ex-menu') {
    const s = state.active.slots[sh.i];
    body = `<h2>${esc(L[s.ex]?.name)}</h2>
      <button class="btn block" data-act="taken" data-where="active" data-i="${sh.i}">Machine taken: auto-substitute</button>
      <button class="btn block" data-act="swap" data-where="active" data-i="${sh.i}">Choose a substitute</button>
      <button class="btn block" data-act="lift" data-ex="${s.ex}" data-i="${sh.i}">History, 1RM and % table</button>
      <button class="btn block" data-act="video" data-ex="${s.ex}">Form videos</button>
      <button class="btn block" data-act="up" data-where="active" data-i="${sh.i}" data-close="1">Move up</button>
      <button class="btn block danger-ghost" data-act="remove-slot" data-where="active" data-i="${sh.i}" data-close="1">Remove exercise</button>`;
  } else if (sh.type === 'set-tech') {
    const s = state.active.slots[sh.i];
    const x = s.log[sh.j];
    const subs = (() => { let k = sh.j + 1, c = 0; while (s.log[k]?.sub) { k++; c++; } return c; })();
    const cur = E.techOf(x.t);
    body = `<h2>${x.warm ? 'Warm-up set' : `Set ${workSets(s.log.slice(0, sh.j + 1)).length}`} · ${esc(L[s.ex]?.name || '')}</h2>
      ${!x.sub ? `<button class="btn block primary" data-act="lift" data-ex="${s.ex}" data-i="${sh.i}" data-j="${sh.j}">Set weight from % of 1RM</button>` : ''}
      <p class="muted small">Pick a technique for this set. Extra rows (drops, mini-sets, partials) appear after you check the set off, with the right rest timer.</p>
      <ul class="pick tech-pick">
        <li><button data-act="pick-tech" data-t="warm" class="${x.warm ? 'on' : ''}"><span class="pick-name"><b>Warm-up set</b><span class="muted">Not counted toward working sets, ratings, PRs or next-time load suggestions. Rest after it is capped at 60 sec.</span></span></button></li>
        <li><button data-act="pick-tech" data-t="" class="${!x.t && !x.warm ? 'on' : ''}"><span class="pick-name"><b>Straight set</b><span class="muted">Working set, no technique</span></span></button></li>
        ${Object.entries(E.TECHNIQUES).map(([k, T]) => `<li><button data-act="pick-tech" data-t="${k}" class="${x.t === k ? 'on' : ''}"><span class="pick-name"><b>${esc(T.label)}</b><span class="muted">${esc(T.desc)}</span></span></button></li>`).join('')}
      </ul>
      ${cur?.sub ? `<button class="btn block" data-act="tech-more" data-d="1">+ Add another ${esc(cur.short.toLowerCase())} row</button>` : ''}
      ${subs ? `<button class="btn block danger-ghost" data-act="tech-more" data-d="-1">− Remove a ${esc(cur?.short?.toLowerCase() || 'extra')} row</button>` : ''}`;
  } else if (sh.type === 'rest') {
    const s = state.active.slots[sh.i];
    const ps = programSlotFor(s);
    const opts = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240];
    body = `<h2>Rest · ${esc(L[s.ex]?.name || '')}</h2>
      <p class="muted small">Currently ${s.rest ? `${s.rest} sec` : 'no rest (straight to the next exercise)'}.</p>
      <div class="chips">${opts.map(v => `<button class="chip-btn ${s.rest === v ? 'on' : ''}" data-act="rest-pick" data-s="${v}">${v ? (v % 60 ? `${Math.floor(v / 60) ? Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0') : v + 's'}` : v / 60 + ' min') : 'None'}</button>`).join('')}</div>
      <label class="field mt">Custom (seconds) <input inputmode="numeric" data-field="rest-custom" value="${esc(sh.custom ?? '')}" placeholder="e.g. 100"></label>
      <button class="btn block" data-act="rest-pick" data-custom="1">Use custom time</button>
      ${ps ? `<label class="check-item inline mt"><input type="checkbox" data-field="rest-perm" ${sh.perm !== false ? 'checked' : ''}><span>Save to “${esc(state.programs[state.active.programId].days.find(d => d.id === state.active.dayId)?.name || 'this day')}” for future workouts${ps.cycleOnly ? ` (${esc(currentWeek(state.active.programId).label)} only, since this exercise's rest is set per cycle)` : ''}</span></label>`
        : '<p class="muted small mt">This workout isn\'t from a program day, so the change applies to this workout only.</p>'}`;
  } else if (sh.type === 'import') {
    body = `<h2>Import</h2>
      <p class="muted small">Paste a program from Claude or a full backup file.</p>
      <label class="field">Import as <select data-field="import-target">
        <option value="auto" ${(sh.target || 'auto') === 'auto' ? 'selected' : ''}>Update the program with the same name, or add it if there isn't one</option>
        <option value="new" ${sh.target === 'new' ? 'selected' : ''}>A new program</option>
        ${Object.values(state.programs).map(x => `<option value="${x.id}" ${sh.target === x.id ? 'selected' : ''}>Update “${esc(x.name)}” (keep my place)</option>`).join('')}
      </select></label>
      <textarea class="full" rows="10" data-field="import-text" placeholder='{"type":"program", ...}'>${esc(sh.text || '')}</textarea>
      ${sh.error ? `<div class="banner warn">${esc(sh.error)}</div>` : ''}
      <button class="btn primary block" data-act="do-import">Import</button>`;
  } else if (sh.type === 'export') {
    body = `<h2>${esc(sh.title)}</h2>
      <textarea class="full mono" rows="12" readonly>${esc(sh.text)}</textarea>
      <button class="btn primary block" data-act="copy-export">Copy to clipboard</button>
      <button class="btn block" data-act="download-export">Download file</button>
      ${dropbox().refresh ? '<button class="btn block" data-act="dropbox-export">Save to Dropbox</button>' : ''}`;
  } else if (sh.type === 'finish') {
    const r = sh.rating;
    body = `<h2>Workout complete</h2>
      <div class="rating-head"><div class="grade ${gradeClass(r.grade)}">${r.grade}</div><div><div class="score">${r.overall}<small>/100</small></div><div class="muted">${sh.sets} sets · ${sh.minutes} min${sh.prs.length ? ' · ' + sh.prs.length + ' PR' + (sh.prs.length > 1 ? 's' : '') : ''}</div></div></div>
      ${sh.prs.length ? `<ul class="notes">${sh.prs.map(p => `<li>New best: ${esc(p)}</li>`).join('')}</ul>` : ''}
      <button class="btn primary block" data-act="close">Done</button>`;
  }
  return `<div class="scrim" data-act="close"></div><div class="sheet sheet-${sh.type}" role="dialog" aria-modal="true"><div class="grabber"></div><button class="icon sheet-x" data-act="close" aria-label="Close">✕</button>${body}</div>`;
}

// ================= render =================
const views = { today: viewToday, build: viewBuild, program: viewProgram, progress: viewProgress, settings: viewSettings };

function render({ keepScroll = true } = {}) {
  const y = window.scrollY;
  $('#main').innerHTML = views[ui.view]();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === ui.view));
  renderSheet();
  if (keepScroll) window.scrollTo(0, y);
  tickTimer();
  tickClock();
}
function renderSheet() {
  const root = $('#sheet-root');
  const scrollEl = root.querySelector('.sheet');
  const sy = scrollEl?.scrollTop || 0;
  root.innerHTML = sheetHTML(); fitSheet();
  document.body.classList.toggle('sheet-open', !!ui.sheet);
  const ns = root.querySelector('.sheet');
  if (ns) ns.scrollTop = sy;
}
function openSheet(s) { ui.sheet = s; renderSheet(); }
function closeSheet() { ui.sheet = null; renderSheet(); }

// ================= actions =================
function startWorkout(slots, meta) {
  const L = lib();
  const week = currentWeek(meta.programId);
  state.active = {
    id: uid(), startedAt: Date.now(), date: todayISO(), taken: [], profile: state.settings.activeProfile,
    ...meta,
    slots: slots.map((s, src) => (meta.dayId ? { ...s, src, srcEx: s.subbedFrom || s.ex } : s)).filter(s => L[s.ex] && !s.missing).map(({ byCycle, ...s }) => withSuggestion({ ...s }, week)),
    cycle: week.idx,
  };
  save({ sync: false });
  keepAwake(true);
  ui.view = 'today';
  window.scrollTo(0, 0);
  render({ keepScroll: false });
}

const mainSets = log => log.filter(x => !x.sub);
const workSets = log => log.filter(x => !x.sub && !x.warm);

// The program slot an active-workout slot came from, for permanent edits.
// Returns { target, cycleOnly } where target is the object holding the rest value.
function programSlotFor(s) {
  const a = state.active;
  if (!a?.programId || !a.dayId || s.src == null) return null;
  const ps = state.programs[a.programId]?.days.find(d => d.id === a.dayId)?.slots?.[s.src];
  if (!ps) return null;
  const cyc = E.slotFor(ps, a.cycle ?? 0);
  if (cyc.ex !== s.srcEx) return null; // the program day was edited since this workout started
  const o = ps.byCycle?.[a.cycle ?? 0];
  return o && o.rest != null ? { target: o, cycleOnly: true } : { target: ps, cycleOnly: false };
}
function setRest(i, v) {
  const s = state.active.slots[i];
  s.rest = Math.max(0, Math.min(900, Math.round(v)));
  const ps = programSlotFor(s);
  const perm = ps && ui.sheet?.perm !== false;
  if (perm) { ps.target.rest = s.rest; ui.preview = null; }
  save({ sync: !!perm });
  closeSheet(); render();
  toast(`Rest set to ${s.rest ? s.rest + ' sec' : 'none'}${perm ? ', saved to the program' : ' for this workout'}.`);
}
// Insert the extra rows a technique needs right after working set j (once).
function addTechRows(s, j, extra = null) {
  const x = s.log[j];
  const T = E.techOf(x.t);
  if (!T?.sub) return;
  let end = j + 1;
  while (s.log[end]?.sub) end++;
  const have = end - (j + 1);
  const want = extra != null ? have + extra : Math.max(have, T.rows);
  const ex = lib()[s.ex];
  const base = +x.w || +s.suggest?.weight || 0;
  const rows = [];
  for (let k = have; k < want; k++) {
    let w = x.w;
    if (x.t === 'drop' && base) w = E.roundTo(base * Math.pow(1 - (x.pct || T.pct) / 100, k + 1), ex?.inc || 5);
    rows.push({ w: w ?? '', r: '', done: false, sub: x.t });
  }
  s.log.splice(end, 0, ...rows);
}
// After finishing row j: rest inside a technique, or the normal rest once its rows are done.
function restAfter(s, j) {
  const x = s.log[j];
  const next = s.log[j + 1];
  if (next?.sub) return E.techOf(next.sub)?.rest ?? 0;
  if (x.t === 'superset' || s.rest === 0) return 0;
  if (x.warm) return Math.min(s.rest, 60);
  return s.rest;
}

function withSuggestion(slot, week) {
  const ex = lib()[slot.ex];
  const sg = E.suggest(ex, slot, history(slot.ex), week);
  slot.suggest = sg;
  slot.log = Array.from({ length: sg.sets }, () => ({ w: sg.weight ?? '', r: '', done: false }));
  // Program preset, e.g. { t: 'drop', on: 'last' } or { t: 'eccentric', on: 'all' }.
  const it = slot.intensity;
  if (it && E.techOf(it.t)) {
    const n = slot.log.length;
    const idx = it.on === 'all' ? [...Array(n).keys()] : it.on === 'first' ? [0] : [n - 1];
    idx.forEach(j => { slot.log[j].t = it.t; if (it.pct) slot.log[j].pct = it.pct; });
  }
  return slot;
}

function finishWorkout() {
  const a = state.active;
  const L = lib();
  const done = a.slots.filter(s => s.log.some(x => x.done));
  if (!done.length && !confirm('No sets are checked off. Save anyway?')) return;
  // PR detection by estimated 1RM.
  const prs = [];
  for (const s of done) {
    if (E.repUnit(L[s.ex]) !== 'reps') continue;
    const best = Math.max(0, ...s.log.filter(x => x.done && x.w && x.r && !x.sub && !x.warm).map(x => E.e1rm(+x.w, +x.r)));
    const prev = Math.max(0, ...history(s.ex).flatMap(h => h.sets.map(x => E.e1rm(x.w, x.r))));
    if (best && prev && best > prev) prs.push(`${L[s.ex].name} (e1RM ${Math.round(best)} ${unit()})`);
  }
  const rating = E.rateSession(a.slots.map(s => ({ ...s, sets: s.log.filter(x => x.done && !x.sub && !x.warm).length })), L, a.focus);
  const minutes = Math.round((Date.now() - a.startedAt) / 60000);
  const session = {
    id: a.id, date: a.date, name: a.name, programId: a.programId, dayId: a.dayId, profile: a.profile,
    startedAt: a.startedAt, finishedAt: Date.now(), updatedAt: Date.now(), minutes,
    rating: { overall: rating.overall, grade: rating.grade },
    slots: a.slots.map(({ suggest, src, srcEx, stash, split, splitKeep, ...s }) => ({ ...s, log: s.log.map(x => ({ w: x.w === '' || x.w == null ? null : +x.w, r: x.r === '' ? null : +x.r, done: x.done, ...(x.t && { t: x.t }), ...(x.sub && { sub: x.sub }), ...(x.warm && { warm: true }) })) })),
  };
  state.sessions.push(session);
  if (a.programId && a.dayId && state.programs[a.programId]) {
    const p = state.programs[a.programId];
    const idx = p.days.findIndex(d => d.id === a.dayId);
    if (idx >= 0) { advanceRotation(p, idx); markReached(p.id, a.date); }
  }
  state.active = null;
  ui.previewDay = null;
  ui.preview = null;
  save();
  keepAwake(false);
  render({ keepScroll: false });
  window.scrollTo(0, 0);
  openSheet({ type: 'finish', rating, minutes, sets: done.reduce((n, s) => n + s.log.filter(x => x.done && !x.sub && !x.warm).length, 0), prs });
}

// Results for the swap / add sheet. Rendered on its own so typing in the search box only
// replaces the list; redrawing the input would close the iPhone keyboard after one letter.
function pickListHTML(sh) {
  const L = lib();
  const cur = sh.type === 'swap' ? (getSlots(sh.where) || [])[sh.i] : null;
  const taken = sh.where === 'active' ? state.active.taken : [];
  const c = ctx(taken);
  const used = usedIds(sh.where);
  if (cur?.subbedFrom) used.delete(cur.subbedFrom);
  const q = (sh.q || '').trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hit = e => words.every(w => e.name.toLowerCase().includes(w) || Object.keys(e.muscles).some(m => MUSCLES[m].toLowerCase().includes(w)) || (PATTERNS[e.pattern] || '').toLowerCase().includes(w));
  let list;
  if (cur && L[cur.ex] && !q) {
    list = E.substitutes(cur.ex, L, c, used, 12).map(r => ({ ex: r.ex, sub: `${Math.round(r.sim * 100)}% match` }));
  } else {
    list = Object.values(L)
      .filter(e => e.id !== cur?.ex && !used.has(e.id) && (sh.all || e.id === cur?.subbedFrom || (q && E.isAvailable(e, ctx([]))) || E.isAvailable(e, c)) && (!q || hit(e)))
      .sort((a, b) => E.quality(b) - E.quality(a)).slice(0, 40)
      .map(e => ({ ex: e, sub: Object.entries(e.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ') }));
  }
  return list.map(({ ex, sub }) => {
    const er = E.rateExercise(ex);
    return `<li><button data-act="pick-ex" data-id="${ex.id}"><span class="chip ${gradeClass(er.grade)}">${er.grade}</span><span class="pick-name"><b>${esc(ex.name)}</b><span class="muted">${esc(sub)} · stretch ${ex.len}/5 · SFR ${ex.sfr}/5</span></span></button></li>`;
  }).join('') || `<li class="muted">${q ? 'No matches. Try another word, or tick "Include equipment not in this profile".' : 'No matches with this equipment.'}</li>`;
}

function applySwap(where, i, newId, takenMark) {
  const slots = getSlots(where);
  const old = slots[i];
  if (where === 'active' && takenMark) state.active.taken.push(old.ex);
  if (where === 'active' && newId === old.subbedFrom) state.active.taken = state.active.taken.filter(id => id !== newId);

  // Undo: going back to the original restores it exactly as it was before the swap,
  // including sets already logged, and removes the split-off copy if there is one.
  if (where === 'active' && newId === old.subbedFrom && old.stash?.ex === newId) {
    const prev = slots[i - 1];
    const wasSplit = old.split && prev?.ex === newId && prev.splitKeep;
    slots.splice(wasSplit ? i - 1 : i, wasSplit ? 2 : 1, old.stash);
    persistFor(where);
    return;
  }

  // Swaps made before undo existed carried the log over: going back just renames the exercise.
  if (where === 'active' && newId === old.subbedFrom && !old.stash) {
    const back = { ...old, ex: newId, missing: false };
    delete back.subbedFrom;
    slots[i] = back;
    persistFor(where);
    return;
  }

  const next = { ...old, ex: newId, subbedFrom: old.subbedFrom || old.ex, missing: false };
  delete next.stash; delete next.split; delete next.splitKeep;
  if (next.subbedFrom === newId) delete next.subbedFrom;
  if (where !== 'active') { slots[i] = next; persistFor(where); return; }

  // Keep the very first original while nothing new has been logged (A → B → C, back to A).
  const stash = old.stash && !old.log.some(x => x.done) ? old.stash : (({ stash: _s, ...o }) => JSON.parse(JSON.stringify(o)))(old);
  const week = currentWeek(state.active.programId);
  const done = old.log.filter(x => x.done);
  if (!done.length) {
    withSuggestion(next, week);
    next.stash = stash;
    if (old.split) next.split = true;
    slots[i] = next;
  } else {
    // Mid-exercise swap: finished sets stay with the original exercise; the new one gets
    // only the sets that were left, with a fresh log.
    const keep = { ...old, log: done, sets: done.filter(x => !x.sub && !x.warm).length || done.length, splitKeep: true };
    delete keep.group; delete keep.stash; delete keep.split;
    const left = Math.max(1, old.log.filter(x => !x.done && !x.sub && !x.warm).length);
    withSuggestion(next, week);
    while (next.log.length < left) next.log.push({ w: next.suggest?.weight ?? '', r: '', done: false });
    next.log = next.log.slice(0, left);
    next.sets = left;
    next.stash = stash;
    next.split = true;
    slots.splice(i, 1, keep, next);
  }
  persistFor(where);
}

function autoTaken(where, i) {
  const slots = getSlots(where);
  const L = lib();
  const taken = where === 'active' ? [...state.active.taken, slots[i].ex] : [slots[i].ex];
  const alt = E.substitutes(slots[i].ex, L, ctx(taken), usedIds(where), 1)[0];
  if (!alt) { toast('No substitute available with this equipment.'); return; }
  applySwap(where, i, alt.ex.id, true);
  toast(`Swapped to ${alt.ex.name}`);
  closeSheet();
  render();
}

function newSlot(exId) {
  const ex = lib()[exId];
  const scheme = ex.compound ? { reps: [6, 10], rest: 150 } : ['lateral_raise', 'calf', 'rear_delt'].includes(ex.pattern) ? { reps: [12, 20], rest: 75 } : { reps: [10, 15], rest: 90 };
  return { ex: exId, sets: 3, ...scheme };
}

function exportProgram(p) {
  const L = lib();
  const custom = {};
  p.days.forEach(d => d.slots.forEach(s => { if (L[s.ex]?.custom) custom[s.ex] = state.customExercises[s.ex]; }));
  const slotOut = ({ ex, sets, reps, rest, tech, note, group, intensity, byCycle }) => ({ ex, sets, reps, rest, ...(tech && { tech }), ...(note && { note }), ...(group && { group }), ...(intensity && { intensity }), ...(byCycle && { byCycle }) });
  const out = {
    type: 'program', name: p.name,
    ...(p.cycles?.length && { cycles: p.cycles }),
    days: p.days.map(({ name, focus, rest, slots }) => (rest ? { name, rest: true } : { name, focus, slots: slots.map(slotOut) })),
    customExercises: custom,
  };
  return JSON.stringify(out, null, 1);
}

function findByName(name) {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const L = lib();
  let best = null, bestScore = 0;
  for (const e of Object.values(L)) {
    const en = e.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (en === n) return e.id;
    const sc = en.includes(n) || n.includes(en) ? Math.min(en.length, n.length) / Math.max(en.length, n.length) : 0;
    if (sc > bestScore) { bestScore = sc; best = e.id; }
  }
  return bestScore > 0.6 ? best : null;
}

function doImport(text, target = 'auto') {
  let data;
  try { data = JSON.parse(text.trim().replace(/^```(json)?|```$/g, '')); } catch { throw new Error('That is not valid JSON. Paste the whole block, including the first { and last }.'); }
  if (data.sessions && data.programs) {
    if (!confirm('This is a full backup. Replace all data on this device with it?')) return null;
    replaceState(data);
    return 'Backup restored.';
  }
  if (data.type !== 'program' || !Array.isArray(data.days)) throw new Error('Expected {"type":"program","days":[...]}');
  Object.assign(state.customExercises, data.customExercises || {});
  const L = lib();
  const problems = [];
  const parseReps = r => (Array.isArray(r) ? r.map(Number) : String(r || '8-12').split(/[-–]/).map(Number).concat([NaN]).slice(0, 2).map((v, k, arr) => (isNaN(v) ? (k ? arr[0] : 10) : v)));
  const resolveEx = (ex, name) => {
    const id = L[ex] ? ex : findByName(name || ex || '');
    if (!id) problems.push(name || ex);
    return id || ex;
  };
  const days = data.days.map((d, di) => (d.rest ? { id: uid(), name: d.name || 'Rest', rest: true, slots: [] } : {
    id: uid(), name: d.name || `Day ${di + 1}`, focus: E.FOCUS[d.focus] ? d.focus : 'full', muscles: d.muscles,
    slots: (d.slots || []).map(s => {
      const id = resolveEx(s.ex, s.name);
      const ex = L[id];
      const slot = {
        ex: id, sets: +s.sets || 3, reps: parseReps(s.reps),
        rest: s.rest != null && !isNaN(+s.rest) ? +s.rest : (ex?.compound ? 150 : 90),
      };
      if (s.tech) slot.tech = String(s.tech);
      if (s.note) slot.note = String(s.note);
      if (s.group) slot.group = String(s.group);
      if (s.intensity && E.techOf(s.intensity.t)) slot.intensity = { t: s.intensity.t, on: s.intensity.on || 'last', ...(s.intensity.pct && { pct: +s.intensity.pct }) };
      if (Array.isArray(s.byCycle)) slot.byCycle = s.byCycle.map(o => {
        if (!o) return null;
        const c = { ...o };
        if (c.ex) c.ex = resolveEx(c.ex, c.name);
        delete c.name;
        if (c.reps) c.reps = parseReps(c.reps);
        if (c.sets != null) c.sets = +c.sets;
        return c;
      });
      return slot;
    }),
  }));
  if (!days.some(d => !d.rest)) throw new Error('The program has no training days.');
  const cycles = Array.isArray(data.cycles) ? data.cycles.map((c, i) => ({ label: c.label || `Cycle ${i + 1}`, ...(c.effort && { effort: String(c.effort) }), ...(c.rir != null && { rir: String(c.rir) }), ...(c.deload && { deload: true }) })) : null;
  const name = data.name || 'Imported program';
  const existing = target === 'new' ? null
    : target === 'auto' ? Object.values(state.programs).find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase())
    : state.programs[target];
  if (existing) {
    const msg = updateProgram(existing, { name, days, cycles });
    return problems.length ? `${msg} ${problems.length} exercise(s) not recognized: ${problems.join(', ')}.` : msg;
  }
  const id = uid();
  state.programs[id] = { id, name, days, ...(cycles?.length && { cycles }) };
  // Starting point: a past startDate places the program where that schedule is today;
  // otherwise startCycle / startDay (1-based), defaulting to the beginning.
  let startDay = (+data.startDay || 1) - 1, startCycle = (+data.startCycle || 1) - 1;
  if (/^\d{4}-\d{2}-\d{2}$/.test(data.startDate || '') && data.startDate <= todayISO()) {
    const pos = datePos(state.programs[id], data.startDate);
    startDay = pos.dayIdx; startCycle = pos.cycleIdx;
  }
  state.rotation[id] = Math.max(0, Math.min(days.length - 1, startDay));
  state.cycleIdx = state.cycleIdx || {};
  state.cycleIdx[id] = cycles?.length ? Math.max(0, Math.min(cycles.length - 1, startCycle)) : 0;
  markReached(id, isoShift(todayISO(), -1));
  state.settings.activeProgram = id;
  save();
  return problems.length ? `Imported. ${problems.length} exercise(s) not recognized: ${problems.join(', ')}. Tap them to choose a match.` : `Imported “${state.programs[id].name}” and set it active.`;
}

// Replace a program's contents in place. Keeps its id, the ids of matching days (so history
// and an in-progress workout still line up), the current day, the current cycle and the
// rest-day anchor. Exercise history is keyed by exercise, so load suggestions carry over.
function updateProgram(p, { name, days, cycles }) {
  const oldDays = p.days;
  const curId = oldDays[(state.rotation[p.id] || 0) % oldDays.length]?.id;
  const curIdx = (state.rotation[p.id] || 0) % oldDays.length;
  const taken = new Set();
  const norm = x => x.trim().toLowerCase();
  // Match by name first, then by position for days that were renamed.
  days.forEach(d => { const od = oldDays.find(o => !taken.has(o.id) && norm(o.name) === norm(d.name) && !!o.rest === !!d.rest); if (od) { d.id = od.id; taken.add(od.id); } });
  days.forEach((d, i) => { if (taken.has(d.id)) return; const od = oldDays[i]; if (od && !taken.has(od.id) && !!od.rest === !!d.rest) { d.id = od.id; taken.add(od.id); } });
  p.name = name;
  p.days = days;
  if (cycles?.length) p.cycles = cycles; else delete p.cycles;
  let at = days.findIndex(d => d.id === curId);
  if (at < 0) at = Math.min(curIdx, days.length - 1);
  state.rotation[p.id] = at;
  state.cycleIdx = state.cycleIdx || {};
  if (p.cycles) state.cycleIdx[p.id] = Math.min(state.cycleIdx[p.id] || 0, p.cycles.length - 1);
  else delete state.cycleIdx[p.id];
  ui.preview = null;
  save();
  const w = currentWeek(p.id);
  return `Updated “${p.name}”. You're still on ${days[at].name}${p.cycles ? `, ${w.label}` : ''}.`;
}

function deleteProgram(id) {
  if (Object.keys(state.programs).length < 2) { toast('Keep at least one program.'); return; }
  const p = state.programs[id];
  if (state.active?.programId === id) { toast('Finish or discard the workout in progress first.'); return; }
  if (!confirm(`Delete “${p.name}”? Logged workouts and lift history are kept.`)) return;
  delete state.programs[id];
  delete state.rotation[id];
  if (state.cycleIdx) delete state.cycleIdx[id];
  if (state.lastDone) delete state.lastDone[id];
  if (state.settings.activeProgram === id) state.settings.activeProgram = Object.keys(state.programs)[0];
  ui.preview = null; ui.editDay = null;
  save(); render(); toast(`Deleted “${p.name}”.`);
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const actions = {
  nav: el => { ui.view = el.dataset.view; ui.editDay = null; render({ keepScroll: false }); window.scrollTo(0, 0); },
  close: () => closeSheet(),
  'pick-day': el => { ui.previewDay = el.dataset.id; ui.preview = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  start: () => {
    const p = program();
    const day = p.days.find(d => d.id === ui.preview.dayId);
    startWorkout(ui.preview.slots, { programId: p.id, dayId: day.id, name: day.name, focus: focusMuscles(day) });
  },
  'sheet-profile': () => openSheet({ type: 'profile' }),
  profile: el => { state.settings.activeProfile = el.dataset.id; ui.preview = null; save(); if (el.dataset.close) closeSheet(); render(); },
  'go-settings': () => { closeSheet(); ui.view = 'settings'; render({ keepScroll: false }); },
  swap: el => openSheet({ type: 'swap', where: el.dataset.where, i: +el.dataset.i }),
  'add-ex': el => openSheet({ type: 'add', where: el.dataset.where }),
  'pick-ex': el => {
    const sh = ui.sheet;
    if (sh.type === 'swap') applySwap(sh.where, sh.i, el.dataset.id, false);
    else {
      const slot = newSlot(el.dataset.id);
      if (sh.where === 'active') withSuggestion(slot, currentWeek(state.active.programId));
      getSlots(sh.where).push(slot);
      persistFor(sh.where);
    }
    closeSheet(); render();
  },
  taken: el => autoTaken(el.dataset.where, +el.dataset.i),
  video: el => openSheet({ type: 'video', id: el.dataset.ex }),
  'ex-menu': el => openSheet({ type: 'ex-menu', i: +el.dataset.i }),
  lift: el => {
    const i = el.dataset.i != null ? +el.dataset.i : null;
    let j = el.dataset.j != null ? +el.dataset.j : null;
    if (i != null && j == null) { // from the card: aim at the next unfinished working set
      const log = state.active?.slots[i]?.log || [];
      j = log.findIndex(x => !x.done && !x.sub && !x.warm);
      if (j < 0) j = null;
    }
    openSheet({ type: 'lift', ex: el.dataset.ex, i: j == null ? null : i, j });
  },
  'pct-apply': el => {
    const sh = ui.sheet;
    let w = +el.dataset.w;
    if (el.dataset.custom) {
      const p = parseFloat(sh.pct);
      if (!p) return toast('Enter a percentage.');
      w = roundLoad(liftStats(sh.ex).e1rm * p / 100);
    }
    applyWeight(sh.i, sh.j, w);
    closeSheet(); render();
    toast(`${fmtW(w)} ${unit()} set.`);
  },
  sets: el => {
    const s = editTarget(el.dataset.where, +el.dataset.i, 'sets');
    s.sets = Math.max(1, Math.min(10, s.sets + +el.dataset.d));
    persistFor(el.dataset.where); render();
  },
  up: el => {
    const slots = getSlots(el.dataset.where), i = +el.dataset.i;
    if (i > 0) [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]];
    persistFor(el.dataset.where); if (el.dataset.close) closeSheet(); render();
  },
  'remove-slot': el => {
    getSlots(el.dataset.where).splice(+el.dataset.i, 1);
    persistFor(el.dataset.where); if (el.dataset.close) closeSheet(); render();
  },
  done: el => {
    hideRestAlert();
    const s = state.active.slots[+el.dataset.i];
    const x = s.log[+el.dataset.j];
    const j = +el.dataset.j;
    if (!x.done) {
      if (x.warm) {
        const wu = E.warmups(lib()[s.ex], +(s.log.find(y => !y.warm && !y.sub && y.w !== '' && y.w != null)?.w || s.suggest?.weight));
        const k = s.log.slice(0, j).filter(y => y.warm).length;
        if ((x.w === '' || x.w == null) && wu[k]) x.w = wu[k].w;
        if (x.r === '' && wu[k]) x.r = wu[k].r;
      } else {
        const prevW = s.log.slice(0, j).reverse().find(p => !p.warm && p.w !== '' && p.w != null)?.w;
        if (x.w === '' || x.w == null) x.w = prevW ?? s.suggest?.weight ?? '';
        const subReps = x.sub ? E.techOf(x.sub)?.reps : null;
        if (x.r === '' && (x.sub ? subReps : s.suggest?.reps)) x.r = x.sub ? subReps : s.suggest.reps;
      }
      x.done = true;
      if (!x.sub && E.techOf(x.t)?.sub) addTechRows(s, j);
      const isLast = j === s.log.length - 1 && +el.dataset.i === state.active.slots.length - 1;
      const rest = restAfter(s, j);
      const next = s.log[j + 1];
      if (isLast) {}
      else if (rest > 0) startTimer(rest);
      else if (next?.sub) toast(next.sub === 'drop' ? 'Drop the weight and go. No rest.' : `${E.techOf(next.sub).short}: keep going, no rest.`);
      else if (s.group || x.t === 'superset') toast('No rest: straight to the next exercise.');
    } else x.done = false;
    save({ sync: false }); render();
  },
  'set-tech': el => openSheet({ type: 'set-tech', i: +el.dataset.i, j: +el.dataset.j }),
  'pick-tech': el => {
    const { i, j } = ui.sheet;
    const s = state.active.slots[i];
    const x = s.log[j];
    // Changing technique clears unfinished extra rows from the old one.
    let k = j + 1; while (s.log[k]?.sub) k++;
    const extra = s.log.slice(j + 1, k);
    if (extra.every(r => !r.done)) s.log.splice(j + 1, extra.length);
    delete x.pct;
    if (el.dataset.t === 'warm') { x.warm = true; delete x.t; }
    else { delete x.warm; x.t = el.dataset.t || undefined; if (!x.t) delete x.t; }
    if (x.done && E.techOf(x.t)?.sub) addTechRows(s, j);
    save({ sync: false }); closeSheet(); render();
  },
  'tech-more': el => {
    const { i, j } = ui.sheet;
    const s = state.active.slots[i];
    if (+el.dataset.d > 0) addTechRows(s, j, 1);
    else { let k = j + 1; while (s.log[k]?.sub) k++; if (k > j + 1) s.log.splice(k - 1, 1); }
    save({ sync: false }); renderSheet(); render();
  },
  'add-warm': el => {
    const s = state.active.slots[+el.dataset.i];
    let at = 0; while (s.log[at]?.warm) at++;
    s.log.splice(at, 0, { w: '', r: '', done: false, warm: true });
    save({ sync: false }); render();
  },
  'rest-edit': el => { const s = state.active.slots[+el.dataset.i]; openSheet({ type: 'rest', i: +el.dataset.i, perm: true, custom: s.rest }); },
  'rest-pick': el => {
    const v = el.dataset.custom ? parseInt(ui.sheet.custom, 10) : +el.dataset.s;
    if (isNaN(v)) return toast('Enter a number of seconds.');
    setRest(ui.sheet.i, v);
  },
  'add-set': el => { const s = state.active.slots[+el.dataset.i]; const last = workSets(s.log).pop(); s.log.push({ w: last?.w ?? '', r: '', done: false }); save({ sync: false }); render(); },
  'del-set': el => { const s = state.active.slots[+el.dataset.i]; if (s.log.length > 1) { if (s.log[s.log.length - 1].sub) s.log.pop(); else if (workSets(s.log).length > 1 || s.log[s.log.length - 1].warm) s.log.pop(); } save({ sync: false }); render(); },
  'toggle-rating': () => { ui.showRating = !ui.showRating; render(); },
  finish: () => finishWorkout(),
  discard: () => { if (confirm('Discard this workout? Logged sets will be lost.')) { state.active = null; save({ sync: false }); keepAwake(false); render(); } },
  'timer-add': el => { if (state.active?.timerEnd) { state.active.timerEnd += +el.dataset.s * 1000; state.active.timerTotal += +el.dataset.s; tickTimer(); } },
  'rest-alert-ok': () => hideRestAlert(),
  'timer-skip': () => { if (state.active) { state.active.timerEnd = null; save({ sync: false }); tickTimer(); } },
  // build
  'b-focus': el => { ui.build.focus = el.dataset.k; ui.build.muscles = [...E.FOCUS[el.dataset.k]]; ui.build.slots = null; render(); },
  'b-muscle': el => { const m = el.dataset.m, b = ui.build; b.muscles = b.muscles.includes(m) ? b.muscles.filter(x => x !== m) : [...b.muscles, m]; b.focus = null; render(); },
  'b-min': el => { ui.build.minutes = +el.dataset.m; render(); },
  'b-gen': () => {
    const b = ui.build;
    if (!b.muscles.length) return toast('Pick at least one muscle.');
    b.seed = (b.seed * 7 + 13) % 100000;
    b.slots = E.generate({ muscles: b.muscles, minutes: b.minutes, seed: b.seed }, lib(), ctx());
    if (!b.slots.length) toast('Nothing fits this equipment profile.');
    render();
  },
  'b-start': () => {
    const b = ui.build;
    const name = b.focus ? `${E.FOCUS_LABEL[b.focus]} (custom)` : 'Custom workout';
    startWorkout(b.slots, { programId: null, dayId: null, name, focus: b.muscles });
  },
  'b-save': () => {
    const b = ui.build;
    const name = prompt('Name for this day', b.focus ? `${E.FOCUS_LABEL[b.focus]} C` : 'Custom day');
    if (!name) return;
    program().days.push({ id: uid(), name, focus: b.focus || 'full', muscles: b.focus ? undefined : [...b.muscles], slots: structuredClone(b.slots) });
    save(); toast('Saved to program.');
  },
  // program
  'edit-day': el => { ui.editDay = ui.editDay === +el.dataset.i ? null : +el.dataset.i; render(); },
  'add-day': () => { const p = program(); p.days.push({ id: uid(), name: `Day ${p.days.length + 1}`, focus: 'full', slots: [] }); ui.editDay = p.days.length - 1; save(); render(); },
  'del-day': el => { const p = program(); if (p.days.length < 2) return toast('A program needs at least one day.'); if (confirm(`Delete ${p.days[+el.dataset.i].name}?`)) { p.days.splice(+el.dataset.i, 1); ui.editDay = null; save(); render(); } },
  'day-up': el => { const d = program().days, i = +el.dataset.i; if (i > 0) { [d[i - 1], d[i]] = [d[i], d[i - 1]]; ui.editDay = i - 1; save(); render(); } },
  'rest-done': el => { const p = program(); advanceRotation(p, +el.dataset.i); markReached(p.id); ui.preview = null; ui.previewDay = null; save(); render(); toast('Rest logged. Next day is up.'); },
  'add-rest': () => { const p = program(); p.days.push({ id: uid(), name: 'Rest', rest: true, slots: [] }); save(); render(); },
  'set-next': el => {
    const p = program();
    state.rotation[p.id] = +el.dataset.i;
    markReached(p.id, isoShift(todayISO(), -1));
    ui.preview = null; save(); toast('Set as next workout.'); render();
  },
  'prog-new': () => { const name = prompt('Program name'); if (!name) return; const id = uid(); state.programs[id] = { id, name, days: [{ id: uid(), name: 'Day 1', focus: 'full', slots: [] }] }; state.rotation[id] = 0; state.settings.activeProgram = id; ui.editDay = 0; save(); render(); },
  'prog-dup': () => { const p = structuredClone(program()); p.id = uid(); p.name += ' (copy)'; state.programs[p.id] = p; state.rotation[p.id] = 0; state.settings.activeProgram = p.id; save(); render(); },
  'prog-rename': () => { const p = program(); const n = prompt('Rename program', p.name); if (n) { p.name = n; save(); render(); } },
  'prog-del': el => deleteProgram(el.dataset.id || program().id),
  'prog-use': el => { state.settings.activeProgram = el.dataset.id; ui.preview = null; ui.editDay = null; save(); render(); toast(`Now using “${state.programs[el.dataset.id].name}”.`); },
  'prog-export': () => openSheet({ type: 'export', title: 'Export program', text: exportProgram(program()), file: 'program.json' }),
  'sheet-import': el => openSheet({ type: 'import', target: el.dataset.id || 'auto' }),
  'do-import': () => {
    try { const msg = doImport(ui.sheet.text || '', ui.sheet.target || 'auto'); if (msg) { closeSheet(); ui.preview = null; ui.view = 'program'; render({ keepScroll: false }); toast(msg); } }
    catch (e) { ui.sheet.error = e.message; renderSheet(); }
  },
  'copy-export': async () => { try { await navigator.clipboard.writeText(ui.sheet.text); toast('Copied.'); } catch { toast('Copy failed. Select the text and copy it manually.'); } },
  'download-export': () => download(ui.sheet.file, ui.sheet.text),
  'dropbox-export': async () => { try { await saveToDropbox('/exports/' + ui.sheet.file, ui.sheet.text); toast('Saved to Dropbox.'); } catch (e) { toast(e.message); } },
  'dropbox-connect': async () => {
    // Open the window inside the tap so iOS doesn't block it, then point it at Dropbox.
    const w = window.open('', '_blank');
    try { const url = await connectDropbox(); if (w) w.location.href = url; else location.href = url; }
    catch (e) { w?.close(); toast(e.message); }
  },
  'push-enable': async () => { try { await enablePush(); render(); toast('Notifications on.'); } catch (e) { toast(e.message); } },
  'push-test': async () => {
    const c = pushCfg();
    try {
      const r = await pushPost('/schedule', { sub: c.sub, at: Date.now() + 10000 });
      if (!r.ok) throw new Error(`Push server error ${r.status}`);
      toast('Lock your phone now. The test arrives in 10 sec.');
    } catch (e) { toast(e.message); }
  },
  'push-off': async () => { try { (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch {} setPush({ on: false, sub: null }); render(); },
  'dropbox-finish': async () => {
    const code = document.querySelector('[data-field="dropbox-code"]')?.value || '';
    if (!code.trim()) return toast('Paste the code from Dropbox first.');
    try { await finishDropboxCode(code); toast('Dropbox connected. Saving…'); render(); await syncNow(); render(); toast('Saved to Dropbox.'); }
    catch (e) { render(); toast(e.message); }
  },
  'dropbox-clear': () => { if (confirm('Disconnect Dropbox on this device? Files already in Dropbox stay there.')) { clearDropbox(); render(); } },
  // progress
  pt: el => { $('#chart-tip').textContent = el.dataset.label; },
  'del-session': el => { if (confirm('Delete this workout from history?')) { state.sessions = state.sessions.filter(s => s.id !== el.dataset.id); state.deleted.push(el.dataset.id); save(); render(); } },
  // settings
  'profile-new': () => { const n = prompt('Profile name (e.g. Home, Hotel)'); if (!n) return; const id = uid(); state.profiles[id] = { name: n, equip: ['dumbbell', 'bench', 'incline_bench'] }; state.settings.activeProfile = id; save(); render(); },
  'profile-del': () => { const id = state.settings.activeProfile; if (confirm(`Delete profile “${state.profiles[id].name}”?`)) { delete state.profiles[id]; state.settings.activeProfile = Object.keys(state.profiles)[0]; save(); render(); } },
  'equip-all': () => { profile().equip = Object.keys(EQUIPMENT); ui.preview = null; save(); render(); },
  'equip-none': () => { profile().equip = []; ui.preview = null; save(); render(); },
  restday: el => { const d = +el.dataset.d, r = state.settings.restDays; state.settings.restDays = r.includes(d) ? r.filter(x => x !== d) : [...r, d]; save(); render(); },
  'new-block': () => { if (confirm('Start a new 5-week block at week 1?')) { state.settings.mesoStart = programSessions(state.settings.activeProgram).length; save(); render(); } },
  unit: el => { state.settings.unit = el.dataset.u; save(); render(); },
  sync: async () => { try { await syncNow(); ui.preview = null; render(); toast('Synced.'); } catch (e) { render(); } },
  'gist-clear': () => { if (confirm('Remove the token from this device? Your Gist is not deleted.')) { localStorage.removeItem('liftapp.gist'); render(); } },
  backup: () => openSheet({ type: 'export', title: 'Full backup', text: JSON.stringify(state), file: `workout-backup-${todayISO()}.json` }),
  reset: () => { if (confirm('Erase all data on this device? (Your Gist copy is not touched.)')) { resetAll(); ui.preview = null; render(); } },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

// Inputs: update state without a full re-render while typing.
document.addEventListener('input', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (!f) return;
  const i = +el.dataset.i;
  if (f === 'w' || f === 'r') {
    const log = state.active.slots[i].log, j = +el.dataset.j;
    const old = log[j][f];
    log[j][f] = el.value;
    if (f === 'w' && !log[j].warm) log.forEach((x, k) => {
      // Carry the new weight down to later, unfinished sets that matched the old value.
      if (k > j && !x.done && !x.warm && (x.w === '' || x.w == null || String(x.w) === String(old))) {
        x.w = el.value;
        const inp = document.querySelector(`[data-field="w"][data-i="${i}"][data-j="${k}"]`);
        if (inp) inp.value = el.value;
      }
    });
    save({ sync: false });
  } else if (f === 'rlo' || f === 'rhi' || f === 'rest') {
    const s = editTarget(el.dataset.where, i, f === 'rest' ? 'rest' : 'reps');
    const v = parseInt(el.value, 10);
    if (!isNaN(v)) { if (f === 'rest') s.rest = v; else { s.reps = [...s.reps]; s.reps[f === 'rlo' ? 0 : 1] = v; } persistFor(el.dataset.where); }
  } else if (f === 'day-name') { program().days[i].name = el.value; save(); }
  else if (f === 'profile-name') { profile().name = el.value; save(); }
  else if (f === 'gist-token') setGist({ token: el.value.trim() });
  else if (f === 'gist-id') setGist({ id: el.value.trim() });
  else if (f === 'sheet-q') { ui.sheet.q = el.value; const ul = document.getElementById('pick-list'); if (ul) ul.innerHTML = pickListHTML(ui.sheet); }
  else if (f === 'import-text') ui.sheet.text = el.value;
  else if (f === 'rest-custom') ui.sheet.custom = el.value;
  else if (f === 'pct-custom') {
    ui.sheet.pct = el.value;
    const p = parseFloat(el.value), out = document.getElementById('pct-out');
    if (out) out.textContent = p ? `${fmtW(roundLoad(liftStats(ui.sheet.ex).e1rm * p / 100))} ${unit()}` : '—';
  }
  else if (f === 'dropbox-key') setDropbox({ appKey: el.value.trim() });
  else if (f === 'push-url') setPush({ url: el.value.trim() });
});

document.addEventListener('change', e => {
  const el = e.target;
  const f = el.dataset.field;
  if (!f) return;
  if (f === 'equip') {
    const eq = profile().equip, id = el.dataset.id;
    profile().equip = el.checked ? [...new Set([...eq, id])] : eq.filter(x => x !== id);
    ui.preview = null; save();
  } else if (f === 'program-select') { state.settings.activeProgram = el.value; ui.editDay = null; ui.preview = null; save(); render(); }
  else if (f === 'cycle-select') { state.cycleIdx = state.cycleIdx || {}; state.cycleIdx[program().id] = +el.value; ui.preview = null; save(); render(); }
  else if (f === 'day-focus') { program().days[+el.dataset.i].focus = el.value; save(); render(); }
  else if (f === 'progress-ex') { ui.progressEx = el.value; render(); }
  else if (f === 'sheet-all') { ui.sheet.all = el.checked; const ul = document.getElementById('pick-list'); if (ul) ul.innerHTML = pickListHTML(ui.sheet); else renderSheet(); }
  else if (f === 'import-target') { ui.sheet.target = el.value; }
  else if (f === 'rest-perm') { ui.sheet.perm = el.checked; }
  else if (f === 'intensity') {
    const s = editTarget(el.dataset.where, +el.dataset.i, 'intensity');
    if (el.value) s.intensity = { t: el.value, on: ALL_SETS_TECH.has(el.value) ? 'all' : 'last' };
    else if (s === getSlots(el.dataset.where)[+el.dataset.i]) delete s.intensity; else s.intensity = null;
    persistFor(el.dataset.where); render();
  }
  else if (['rlo', 'rhi', 'rest', 'day-name', 'w', 'r'].includes(f)) { if (!['w', 'r'].includes(f)) render(); }
});

onSync(() => { if (ui.view === 'settings') render(); });

// Upgrade the stored copy of the built-in program when its revision changes. Keeps the
// current day, cycle and history (updateProgram matches days by name).
function upgradeDefaultProgram() {
  const p = state.programs[DEFAULT_PROGRAM.id];
  if (!p || (p.rev || 1) >= DEFAULT_PROGRAM.rev) return;
  updateProgram(p, { name: p.name, days: structuredClone(DEFAULT_PROGRAM.days), cycles: p.cycles });
  p.rev = DEFAULT_PROGRAM.rev;
  save();
  setTimeout(() => toast('Program updated: more volume on every day.'), 600);
}

// Keep an open sheet sitting on top of the iPhone keyboard. iOS doesn't shrink fixed
// elements for the keyboard; it scrolls the page instead, which makes the sheet jump.
function fitSheet() {
  const vv = window.visualViewport, el = document.querySelector('.sheet');
  if (!vv || !el) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  el.style.bottom = kb + 'px';
  el.style.maxHeight = el.classList.contains('sheet-swap') || el.classList.contains('sheet-add') ? '' : Math.round(vv.height * 0.92) + 'px';
  if (el.classList.contains('sheet-swap') || el.classList.contains('sheet-add')) el.style.height = Math.round(Math.min(vv.height * 0.92, window.innerHeight * 0.86)) + 'px';
}
window.visualViewport?.addEventListener('resize', fitSheet);
window.visualViewport?.addEventListener('scroll', fitSheet);

// Tapping a weight or reps box selects its number, so typing replaces it (135 → 145, not 14535).
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches?.('input[data-field="w"], input[data-field="r"]') || !el.value) return;
  const sel = () => { try { el.setSelectionRange(0, el.value.length); } catch {} };
  sel();
  setTimeout(sel, 0); // iOS places the caret after focus; select again once it has
});
// iOS can drop the selection on the tap's mouseup; keep it for that first tap.
document.addEventListener('mouseup', e => {
  const el = e.target;
  if (el.matches?.('input[data-field="w"], input[data-field="r"]') && el.dataset.justFocused) e.preventDefault();
  if (el.dataset) delete el.dataset.justFocused;
}, true);
document.addEventListener('focusin', e => { if (e.target.matches?.('input[data-field="w"], input[data-field="r"]')) e.target.dataset.justFocused = '1'; }, true);

// ================= boot =================
upgradeDefaultProgram();
migrateCalendar();
render({ keepScroll: false });
if (state.active) keepAwake(true);
if (gist().token || dropbox().refresh) syncNow().then(() => { upgradeDefaultProgram(); migrateCalendar(); ui.preview = null; render(); }).catch(() => {});
// Updates: check for a new version each time the app comes to the front, and reload once
// when it takes over, so a new version applies on the next open instead of the one after.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    save({ sync: false }); // the workout in progress is in local storage, so a reload is safe
    location.reload();
  });
}
// Which version is running, shown in Setup.
let appVersion = '';
caches?.keys?.().then(k => { appVersion = k.find(x => x.startsWith('lift-')) || ''; }).catch(() => {});
