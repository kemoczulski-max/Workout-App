import { MUSCLES, EQUIPMENT, PATTERNS } from './exercises.js';
import * as E from './engine.js';
import { state, save, uid, todayISO, gist, setGist, syncNow, onSync, syncStatus, replaceState, resetAll } from './store.js';

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

function currentWeek(pid = state.settings.activeProgram) {
  const p = program(pid);
  const n = programSessions(pid).length - (state.settings.mesoStart || 0);
  return E.mesoWeek(Math.max(0, n), p.days.length);
}

function history(exId) {
  const out = [];
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    for (const sl of s.slots) if (sl.ex === exId) {
      const sets = sl.log.filter(x => x.done && x.r).map(x => ({ w: x.w === '' || x.w == null ? null : +x.w, r: +x.r }));
      if (sets.length) out.push({ date: s.date, sets });
    }
  }
  return out;
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

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(audioCtx.currentTime + 0.35);
  } catch {}
  navigator.vibrate?.([200, 100, 200]);
}

function startTimer(sec) {
  if (!state.active) return;
  state.active.timerEnd = Date.now() + sec * 1000;
  state.active.timerTotal = sec;
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
      beep();
      toast('Rest over. Next set.');
      return;
    }
    $('#timer-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#timer-fill').style.width = `${100 - (left / (a.timerTotal || 1)) * 100}%`;
  };
  draw();
  timerInt = setInterval(draw, 250);
}

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

// Editable slot list used by Today preview, Build and Program editor.
function slotList(slots, where, { editable = true } = {}) {
  const L = lib();
  return `<ol class="slots">${slots.map((s, i) => {
    const ex = L[s.ex];
    if (!ex) return `<li class="slot missing"><div class="slot-main"><b>Unknown exercise: ${esc(s.ex)}</b></div>
      <div class="slot-actions"><button class="btn sm" data-act="swap" data-where="${where}" data-i="${i}">Choose</button><button class="btn sm ghost" data-act="remove-slot" data-where="${where}" data-i="${i}">Remove</button></div></li>`;
    const er = E.rateExercise(ex);
    const sub = s.subbedFrom ? `<div class="subbed">↺ Swapped from ${esc(L[s.subbedFrom]?.name || s.subbedFrom)}</div>` : '';
    const miss = s.missing ? `<div class="subbed warn">No equipment match in this profile</div>` : '';
    return `<li class="slot">
      <div class="slot-main">
        <div class="slot-title"><span class="chip ${gradeClass(er.grade)}">${er.grade}</span> <b>${esc(ex.name)}</b></div>
        <div class="slot-meta">
          ${editable ? `
          <span class="stepper"><button data-act="sets" data-d="-1" data-where="${where}" data-i="${i}" aria-label="Fewer sets">−</button>${s.sets} sets<button data-act="sets" data-d="1" data-where="${where}" data-i="${i}" aria-label="More sets">+</button></span>
          <span class="reps"><input inputmode="numeric" data-field="rlo" data-where="${where}" data-i="${i}" value="${s.reps[0]}">–<input inputmode="numeric" data-field="rhi" data-where="${where}" data-i="${i}" value="${s.reps[1]}"> reps</span>
          <span class="reps"><input inputmode="numeric" data-field="rest" data-where="${where}" data-i="${i}" value="${s.rest}">s rest</span>`
          : `<span>${s.sets} × ${s.reps[0]}–${s.reps[1]}</span><span>${s.rest}s rest</span>`}
        </div>
        <div class="slot-tags">${esc(PATTERNS[ex.pattern] || ex.pattern)} · ${Object.entries(ex.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ')}</div>
        ${sub}${miss}
      </div>
      <div class="slot-actions">
        <button class="btn sm" data-act="swap" data-where="${where}" data-i="${i}">Swap</button>
        <button class="btn sm" data-act="taken" data-where="${where}" data-i="${i}" title="Machine busy: auto-substitute">Taken</button>
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
function persistFor(where) {
  if (where === 'active' || where.startsWith('day:')) save({ sync: where !== 'active' });
}
function usedIds(where) { return new Set((getSlots(where) || []).map(s => s.ex)); }

// ================= views =================
function viewToday() {
  if (state.active) return viewActive();
  const p = program();
  const L = lib();
  const rot = (state.rotation[p.id] || 0) % p.days.length;
  const dayIdx = ui.previewDay != null ? p.days.findIndex(d => d.id === ui.previewDay) : rot;
  const day = p.days[dayIdx] || p.days[0];
  const week = currentWeek();
  const isRest = state.settings.restDays.includes(new Date().getDay()) && ui.previewDay == null;
  const doneToday = state.sessions.filter(s => s.date === todayISO());

  if (!ui.preview || ui.preview.dayId !== day.id || ui.preview.profile !== state.settings.activeProfile || ui.preview.programId !== p.id) {
    ui.preview = { dayId: day.id, programId: p.id, profile: state.settings.activeProfile, slots: E.resolveSlots(day.slots, L, ctx()) };
  }
  const r = E.rateSession(ui.preview.slots, L, focusMuscles(day));
  const subs = ui.preview.slots.filter(s => s.subbedFrom).length;

  return `
  <header class="page-head">
    <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
    <h1>${isRest ? 'Rest day' : esc(day.name)}</h1>
    <div class="head-meta">
      <span class="pill">${esc(p.name)}</span>
      <span class="pill ${week.deload ? 'pill-warn' : ''}">${week.label}</span>
      <button class="pill pill-btn" data-act="sheet-profile">⚙ ${esc(profile().name)}</button>
    </div>
  </header>
  ${doneToday.length ? `<div class="banner ok">✓ Logged today: ${doneToday.map(s => esc(s.name)).join(', ')}</div>` : ''}
  ${isRest ? `<div class="card"><p>Today is a scheduled rest day. Next up in the rotation is <b>${esc(day.name)}</b>.</p>
    <button class="btn" data-act="pick-day" data-id="${day.id}">Train ${esc(day.name)} anyway</button></div>` : `
  ${subs ? `<div class="banner">↺ ${subs} exercise${subs > 1 ? 's' : ''} auto-substituted for ${esc(profile().name)}</div>` : ''}
  ${ratingCard(r)}
  <section class="card">
    <div class="card-head"><h2>Exercises</h2><span class="muted">${ui.preview.slots.reduce((a, s) => a + (week.deload ? Math.ceil(s.sets / 2) : s.sets), 0)} sets</span></div>
    ${slotList(ui.preview.slots, 'preview', { editable: false })}
  </section>
  <button class="btn primary block big" data-act="start">Start workout</button>`}
  <section class="card">
    <div class="card-head"><h2>Pick a different day</h2></div>
    <div class="chips">${p.days.map((d, i) => `<button class="chip-btn ${d.id === day.id && !isRest ? 'on' : ''}" data-act="pick-day" data-id="${d.id}">${esc(d.name)}${i === rot ? ' ·next' : ''}</button>`).join('')}</div>
  </section>`;
}

function viewActive() {
  const a = state.active;
  const L = lib();
  const week = currentWeek(a.programId);
  const r = E.rateSession(a.slots.map(s => ({ ...s, sets: s.log.length })), L, a.focus);
  const elapsed = Math.floor((Date.now() - a.startedAt) / 60000);
  const doneSets = a.slots.reduce((n, s) => n + s.log.filter(x => x.done).length, 0);
  const totalSets = a.slots.reduce((n, s) => n + s.log.length, 0);

  const cards = a.slots.map((s, i) => {
    const ex = L[s.ex];
    if (!ex) return '';
    const er = E.rateExercise(ex);
    const workW = s.log.find(x => x.w !== '' && x.w != null)?.w || s.suggest?.weight;
    const wu = E.warmups(ex, +workW);
    const allDone = s.log.length && s.log.every(x => x.done);
    return `
    <section class="card ex-card ${allDone ? 'done' : ''}" id="ex-${i}">
      <div class="ex-head">
        <div>
          <div class="slot-title"><span class="chip ${gradeClass(er.grade)}">${er.grade}</span> <b>${esc(ex.name)}</b></div>
          <div class="muted">${s.reps[0]}–${s.reps[1]} reps · ${s.rest}s rest · RIR ${week.rir}</div>
          ${s.subbedFrom ? `<div class="subbed">↺ Swapped from ${esc(L[s.subbedFrom]?.name || s.subbedFrom)}</div>` : ''}
        </div>
        <button class="icon" data-act="ex-menu" data-i="${i}" aria-label="Exercise options">⋯</button>
      </div>
      ${s.suggest?.note ? `<div class="suggest">↗ ${esc(s.suggest.note)}</div>` : ''}
      ${wu.length ? `<div class="warmup"><span>Warm-up</span>${wu.map(w => `<b>${fmtW(w.w)}×${w.r}</b>`).join('')}</div>` : ''}
      <div class="sets">
        <div class="set-row head"><span>Set</span><span>${unit()}</span><span>Reps</span><span></span></div>
        ${s.log.map((x, j) => `
        <div class="set-row ${x.done ? 'is-done' : ''}">
          <span class="set-n">${j + 1}</span>
          <input inputmode="decimal" data-field="w" data-i="${i}" data-j="${j}" value="${x.w ?? ''}" placeholder="${s.suggest?.weight ?? '—'}">
          <input inputmode="numeric" data-field="r" data-i="${i}" data-j="${j}" value="${x.r ?? ''}" placeholder="${s.suggest?.reps ?? ''}">
          <button class="check ${x.done ? 'on' : ''}" data-act="done" data-i="${i}" data-j="${j}" aria-label="Complete set">✓</button>
        </div>`).join('')}
      </div>
      <div class="row-btns">
        <button class="btn sm ghost" data-act="add-set" data-i="${i}">+ Set</button>
        <button class="btn sm ghost" data-act="del-set" data-i="${i}">− Set</button>
        <button class="btn sm" data-act="taken" data-where="active" data-i="${i}">Taken</button>
        <button class="btn sm" data-act="swap" data-where="active" data-i="${i}">Swap</button>
      </div>
    </section>`;
  }).join('');

  return `
  <header class="page-head">
    <div class="eyebrow">In progress · ${elapsed} min · ${doneSets}/${totalSets} sets</div>
    <h1>${esc(a.name)}</h1>
    <div class="head-meta"><span class="pill ${week.deload ? 'pill-warn' : ''}">${week.label}</span><span class="pill">${esc(state.profiles[a.profile]?.name || '')}</span></div>
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
  const resolved = p.days.map(d => E.resolveSlots(d.slots, L, ctx()));
  const wk = E.rateWeek(resolved, L);
  const rot = (state.rotation[p.id] || 0) % p.days.length;
  return `
  <header class="page-head"><div class="eyebrow">Program</div><h1>${esc(p.name)}</h1>
    <div class="head-meta">
      <select class="pill" data-field="program-select">${Object.values(state.programs).map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span class="pill">${currentWeek().label}</span>
    </div></header>
  <section class="card rating">
    <div class="rating-head"><div class="grade ${gradeClass(wk.grade)}">${wk.grade}</div>
      <div><div class="eyebrow">Weekly volume rating</div><div class="score">${wk.score}<small>/100</small></div><div class="muted">With ${esc(profile().name)} equipment</div></div></div>
    <div class="mlist"><div class="eyebrow">Hard sets per muscle per week <span class="muted">(shaded = target range)</span></div>${weekChart(wk.rows)}</div>
  </section>
  ${p.days.map((d, i) => {
    const r = E.rateSession(resolved[i], L, focusMuscles(d));
    const open = ui.editDay === i;
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
          ${slotList(d.slots, 'day:' + i)}
          <div class="row-btns">
            <button class="btn sm" data-act="set-next" data-i="${i}">Make next up</button>
            <button class="btn sm" data-act="day-up" data-i="${i}">Move up</button>
            <button class="btn sm danger-ghost" data-act="del-day" data-i="${i}">Delete day</button>
          </div>
        </div>` : ''}
    </section>`;
  }).join('')}
  <button class="btn block ghost" data-act="add-day">+ Add day</button>
  <section class="card">
    <div class="card-head"><h2>Programs</h2></div>
    <div class="row-btns">
      <button class="btn sm" data-act="prog-new">New blank</button>
      <button class="btn sm" data-act="prog-dup">Duplicate</button>
      <button class="btn sm" data-act="prog-rename">Rename</button>
      <button class="btn sm" data-act="sheet-import">Import</button>
      <button class="btn sm" data-act="prog-export">Export</button>
      <button class="btn sm danger-ghost" data-act="prog-del">Delete</button>
    </div>
    <p class="muted small">To import a PDF program: upload the PDF to Claude, ask for an app import, then paste the result under Import.</p>
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
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="4" class="dot"/><circle cx="${x(i)}" cy="${y(p.y)}" r="14" class="hit" data-act="pt" data-label="${esc(p.x)}: e1RM ${Math.round(p.y)} ${unit()}${p.best ? ' (' + esc(p.best) + ')' : ''}"/>`).join('')}
  </svg><div class="chart-tip" id="chart-tip">Tap a point for details</div>`;
}

function viewProgress() {
  const L = lib();
  const logged = new Map();
  state.sessions.forEach(s => s.slots.forEach(sl => { if (sl.log.some(x => x.done)) logged.set(sl.ex, (logged.get(sl.ex) || 0) + 1); }));
  const exIds = [...logged.keys()].filter(id => L[id]).sort((a, b) => L[a].name.localeCompare(L[b].name));
  if (!ui.progressEx || !logged.has(ui.progressEx)) ui.progressEx = exIds[0] || null;

  const weekAgo = Date.now() - 7 * 864e5;
  const recent = state.sessions.filter(s => s.finishedAt > weekAgo);
  const weekSets = recent.reduce((n, s) => n + s.slots.reduce((m, sl) => m + sl.log.filter(x => x.done).length, 0), 0);

  let chart = '<p class="muted">Finish a workout to start tracking progress.</p>', table = '';
  if (ui.progressEx) {
    const h = history(ui.progressEx).reverse();
    const pts = h.map(e => {
      const best = e.sets.reduce((b, s) => (E.e1rm(s.w, s.r) > E.e1rm(b.w, b.r) ? s : b), e.sets[0]);
      return { x: new Date(e.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), y: E.e1rm(best.w, best.r), best: `${fmtW(best.w)}×${best.r}` };
    }).filter(p => p.y > 0);
    chart = lineChart(pts);
    table = `<table class="tbl"><thead><tr><th>Date</th><th>Sets (${unit()} × reps)</th></tr></thead><tbody>
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
    <div class="eyebrow mt">Estimated 1-rep max (${unit()})</div>
    ${chart}
    ${table}
  </section>
  <section class="card">
    <div class="card-head"><h2>Recent workouts</h2></div>
    ${state.sessions.slice().reverse().slice(0, 20).map(s => `
      <div class="hist-row">
        <span class="grade sm ${gradeClass(s.rating?.grade || 'D')}">${s.rating?.grade || '–'}</span>
        <div class="day-name"><b>${esc(s.name)}</b><span class="muted">${esc(s.date)} · ${s.minutes ?? '?'} min · ${s.slots.reduce((n, sl) => n + sl.log.filter(x => x.done).length, 0)} sets</span></div>
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
    <div class="chips">${DAYS.map((d, i) => `<button class="chip-btn ${state.settings.restDays.includes(i) ? 'on' : ''}" data-act="restday" data-d="${i}">${d}</button>`).join('')}</div>
    <div class="eyebrow mt">Training block</div>
    <p class="muted small">5-week blocks: RIR 3 → 2 → 1 → 0–1, then a deload week. Weeks advance as you complete each program rotation.</p>
    <p>Currently: <b>${currentWeek().label}</b></p>
    <button class="btn sm" data-act="new-block">Start a new block (back to week 1)</button>
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
    const slots = getSlots(sh.where) || [];
    const cur = sh.type === 'swap' ? slots[sh.i] : null;
    const taken = sh.where === 'active' ? state.active.taken : [];
    const c = ctx(taken);
    const used = usedIds(sh.where);
    const q = (sh.q || '').toLowerCase();
    let list;
    if (cur && L[cur.ex] && !q) {
      list = E.substitutes(cur.ex, L, c, used, 12).map(r => ({ ex: r.ex, sub: `${Math.round(r.sim * 100)}% match` }));
    } else {
      list = Object.values(L)
        .filter(e => !used.has(e.id) && (sh.all || E.isAvailable(e, c)) && (!q || e.name.toLowerCase().includes(q) || Object.keys(e.muscles).some(m => MUSCLES[m].toLowerCase().includes(q))))
        .sort((a, b) => E.quality(b) - E.quality(a)).slice(0, 40)
        .map(e => ({ ex: e, sub: Object.entries(e.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ') }));
    }
    body = `
      <h2>${sh.type === 'swap' ? `Swap ${esc(L[cur?.ex]?.name || '')}` : 'Add exercise'}</h2>
      <input class="full" type="search" placeholder="Search by name or muscle" data-field="sheet-q" value="${esc(sh.q || '')}">
      <label class="check-item inline"><input type="checkbox" data-field="sheet-all" ${sh.all ? 'checked' : ''}><span>Include equipment not in this profile</span></label>
      <ul class="pick">${list.map(({ ex, sub }) => {
        const er = E.rateExercise(ex);
        return `<li><button data-act="pick-ex" data-id="${ex.id}"><span class="chip ${gradeClass(er.grade)}">${er.grade}</span><span class="pick-name"><b>${esc(ex.name)}</b><span class="muted">${esc(sub)} · stretch ${ex.len}/5 · SFR ${ex.sfr}/5</span></span></button></li>`;
      }).join('') || '<li class="muted">No matches with this equipment.</li>'}</ul>`;
  } else if (sh.type === 'video') {
    const ex = L[sh.id];
    body = `<h2>${esc(ex.name)}</h2>
      <p class="muted">Primary: ${Object.entries(ex.muscles).filter(([, w]) => w >= 1).map(([m]) => MUSCLES[m]).join(', ')} · Stretch bias ${ex.len}/5 · SFR ${ex.sfr}/5</p>
      ${videoLinks(ex.name).map(([n, u]) => `<a class="btn block" href="${u}" target="_blank" rel="noopener">▶ ${n} form videos</a>`).join('')}`;
  } else if (sh.type === 'profile') {
    body = `<h2>Where are you training?</h2>
      ${Object.entries(state.profiles).map(([id, p]) => `<button class="btn block ${id === state.settings.activeProfile ? 'primary' : ''}" data-act="profile" data-id="${id}" data-close="1">${esc(p.name)} <span class="muted">· ${p.equip.length} items</span></button>`).join('')}
      <button class="btn block ghost" data-act="go-settings">Edit equipment</button>`;
  } else if (sh.type === 'ex-menu') {
    const s = state.active.slots[sh.i];
    body = `<h2>${esc(L[s.ex]?.name)}</h2>
      <button class="btn block" data-act="taken" data-where="active" data-i="${sh.i}">Machine taken: auto-substitute</button>
      <button class="btn block" data-act="swap" data-where="active" data-i="${sh.i}">Choose a substitute</button>
      <button class="btn block" data-act="video" data-ex="${s.ex}">Form videos</button>
      <button class="btn block" data-act="up" data-where="active" data-i="${sh.i}" data-close="1">Move up</button>
      <button class="btn block danger-ghost" data-act="remove-slot" data-where="active" data-i="${sh.i}" data-close="1">Remove exercise</button>`;
  } else if (sh.type === 'import') {
    body = `<h2>Import</h2>
      <p class="muted small">Paste a program from Claude (converted from a PDF) or a full backup file. Programs are added alongside your existing ones.</p>
      <textarea class="full" rows="10" data-field="import-text" placeholder='{"type":"program", ...}'>${esc(sh.text || '')}</textarea>
      ${sh.error ? `<div class="banner warn">${esc(sh.error)}</div>` : ''}
      <button class="btn primary block" data-act="do-import">Import</button>`;
  } else if (sh.type === 'export') {
    body = `<h2>${esc(sh.title)}</h2>
      <textarea class="full mono" rows="12" readonly>${esc(sh.text)}</textarea>
      <button class="btn primary block" data-act="copy-export">Copy to clipboard</button>
      <button class="btn block" data-act="download-export">Download file</button>`;
  } else if (sh.type === 'finish') {
    const r = sh.rating;
    body = `<h2>Workout complete</h2>
      <div class="rating-head"><div class="grade ${gradeClass(r.grade)}">${r.grade}</div><div><div class="score">${r.overall}<small>/100</small></div><div class="muted">${sh.sets} sets · ${sh.minutes} min${sh.prs.length ? ' · ' + sh.prs.length + ' PR' + (sh.prs.length > 1 ? 's' : '') : ''}</div></div></div>
      ${sh.prs.length ? `<ul class="notes">${sh.prs.map(p => `<li>New best: ${esc(p)}</li>`).join('')}</ul>` : ''}
      <button class="btn primary block" data-act="close">Done</button>`;
  }
  return `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${body}</div>`;
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
}
function renderSheet() {
  const root = $('#sheet-root');
  const scrollEl = root.querySelector('.sheet');
  const sy = scrollEl?.scrollTop || 0;
  root.innerHTML = sheetHTML();
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
    slots: slots.filter(s => L[s.ex] && !s.missing).map(s => withSuggestion({ ...s }, week)),
  };
  save({ sync: false });
  keepAwake(true);
  ui.view = 'today';
  window.scrollTo(0, 0);
  render({ keepScroll: false });
}

function withSuggestion(slot, week) {
  const ex = lib()[slot.ex];
  const sg = E.suggest(ex, slot, history(slot.ex), week);
  slot.suggest = sg;
  slot.log = Array.from({ length: sg.sets }, () => ({ w: sg.weight ?? '', r: '', done: false }));
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
    const best = Math.max(0, ...s.log.filter(x => x.done && x.w && x.r).map(x => E.e1rm(+x.w, +x.r)));
    const prev = Math.max(0, ...history(s.ex).flatMap(h => h.sets.map(x => E.e1rm(x.w, x.r))));
    if (best && prev && best > prev) prs.push(`${L[s.ex].name} (e1RM ${Math.round(best)} ${unit()})`);
  }
  const rating = E.rateSession(a.slots.map(s => ({ ...s, sets: s.log.filter(x => x.done).length })), L, a.focus);
  const minutes = Math.round((Date.now() - a.startedAt) / 60000);
  const session = {
    id: a.id, date: a.date, name: a.name, programId: a.programId, dayId: a.dayId, profile: a.profile,
    startedAt: a.startedAt, finishedAt: Date.now(), updatedAt: Date.now(), minutes,
    rating: { overall: rating.overall, grade: rating.grade },
    slots: a.slots.map(({ suggest, ...s }) => ({ ...s, log: s.log.map(x => ({ w: x.w === '' || x.w == null ? null : +x.w, r: x.r === '' ? null : +x.r, done: x.done })) })),
  };
  state.sessions.push(session);
  if (a.programId && a.dayId && state.programs[a.programId]) {
    const p = state.programs[a.programId];
    const idx = p.days.findIndex(d => d.id === a.dayId);
    if (idx >= 0) state.rotation[p.id] = (idx + 1) % p.days.length;
  }
  state.active = null;
  ui.previewDay = null;
  ui.preview = null;
  save();
  keepAwake(false);
  render({ keepScroll: false });
  window.scrollTo(0, 0);
  openSheet({ type: 'finish', rating, minutes, sets: done.reduce((n, s) => n + s.log.filter(x => x.done).length, 0), prs });
}

function applySwap(where, i, newId, takenMark) {
  const slots = getSlots(where);
  const old = slots[i];
  const next = { ...old, ex: newId, subbedFrom: old.subbedFrom || old.ex, missing: false };
  if (next.subbedFrom === newId) delete next.subbedFrom;
  if (where === 'active') {
    if (takenMark) state.active.taken.push(old.ex);
    const doneSets = old.log.filter(x => x.done);
    if (!doneSets.length) withSuggestion(next, currentWeek(state.active.programId));
    else { next.log = old.log; next.suggest = null; }
  }
  slots[i] = next;
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
  return JSON.stringify({ type: 'program', name: p.name, days: p.days.map(({ name, focus, slots }) => ({ name, focus, slots: slots.map(({ ex, sets, reps, rest }) => ({ ex, sets, reps, rest })) })), customExercises: custom }, null, 1);
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

function doImport(text) {
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
  const days = data.days.map((d, di) => ({
    id: uid(), name: d.name || `Day ${di + 1}`, focus: E.FOCUS[d.focus] ? d.focus : 'full', muscles: d.muscles,
    slots: (d.slots || []).map(s => {
      const id = L[s.ex] ? s.ex : findByName(s.name || s.ex || '');
      if (!id) problems.push(s.name || s.ex);
      const ex = L[id];
      return {
        ex: id || s.ex, sets: +s.sets || 3,
        reps: Array.isArray(s.reps) ? s.reps.map(Number) : String(s.reps || '8-12').split(/[-–]/).map(Number).concat([NaN]).slice(0, 2).map((v, k, arr) => (isNaN(v) ? (k ? arr[0] : 10) : v)),
        rest: +s.rest || (ex?.compound ? 150 : 90),
      };
    }),
  }));
  const id = uid();
  state.programs[id] = { id, name: data.name || 'Imported program', days };
  state.rotation[id] = 0;
  state.settings.activeProgram = id;
  save();
  return problems.length ? `Imported. ${problems.length} exercise(s) not recognized: ${problems.join(', ')}. Tap them to choose a match.` : `Imported “${state.programs[id].name}” and set it active.`;
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
  sets: el => {
    const s = getSlots(el.dataset.where)[+el.dataset.i];
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
    const s = state.active.slots[+el.dataset.i];
    const x = s.log[+el.dataset.j];
    if (!x.done) {
      const prevW = s.log.slice(0, +el.dataset.j).reverse().find(p => p.w !== '' && p.w != null)?.w;
      if (x.w === '' || x.w == null) x.w = prevW ?? s.suggest?.weight ?? '';
      if (x.r === '' && s.suggest?.reps) x.r = s.suggest.reps;
      x.done = true;
      const isLast = +el.dataset.j === s.log.length - 1 && +el.dataset.i === state.active.slots.length - 1;
      if (!isLast) startTimer(s.rest);
    } else x.done = false;
    save({ sync: false }); render();
  },
  'add-set': el => { const s = state.active.slots[+el.dataset.i]; const last = s.log[s.log.length - 1]; s.log.push({ w: last?.w ?? '', r: '', done: false }); save({ sync: false }); render(); },
  'del-set': el => { const s = state.active.slots[+el.dataset.i]; if (s.log.length > 1) s.log.pop(); save({ sync: false }); render(); },
  'toggle-rating': () => { ui.showRating = !ui.showRating; render(); },
  finish: () => finishWorkout(),
  discard: () => { if (confirm('Discard this workout? Logged sets will be lost.')) { state.active = null; save({ sync: false }); keepAwake(false); render(); } },
  'timer-add': el => { if (state.active?.timerEnd) { state.active.timerEnd += +el.dataset.s * 1000; state.active.timerTotal += +el.dataset.s; tickTimer(); } },
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
  'set-next': el => { state.rotation[program().id] = +el.dataset.i; ui.preview = null; save(); toast('Set as next workout.'); render(); },
  'prog-new': () => { const name = prompt('Program name'); if (!name) return; const id = uid(); state.programs[id] = { id, name, days: [{ id: uid(), name: 'Day 1', focus: 'full', slots: [] }] }; state.rotation[id] = 0; state.settings.activeProgram = id; ui.editDay = 0; save(); render(); },
  'prog-dup': () => { const p = structuredClone(program()); p.id = uid(); p.name += ' (copy)'; state.programs[p.id] = p; state.rotation[p.id] = 0; state.settings.activeProgram = p.id; save(); render(); },
  'prog-rename': () => { const p = program(); const n = prompt('Rename program', p.name); if (n) { p.name = n; save(); render(); } },
  'prog-del': () => { if (Object.keys(state.programs).length < 2) return toast('Keep at least one program.'); const p = program(); if (confirm(`Delete “${p.name}”? Logged workouts are kept.`)) { delete state.programs[p.id]; state.settings.activeProgram = Object.keys(state.programs)[0]; save(); render(); } },
  'prog-export': () => openSheet({ type: 'export', title: 'Export program', text: exportProgram(program()), file: 'program.json' }),
  'sheet-import': () => openSheet({ type: 'import' }),
  'do-import': () => {
    try { const msg = doImport(ui.sheet.text || ''); if (msg) { closeSheet(); ui.preview = null; ui.view = 'program'; render({ keepScroll: false }); toast(msg); } }
    catch (e) { ui.sheet.error = e.message; renderSheet(); }
  },
  'copy-export': async () => { try { await navigator.clipboard.writeText(ui.sheet.text); toast('Copied.'); } catch { toast('Copy failed. Select the text and copy it manually.'); } },
  'download-export': () => download(ui.sheet.file, ui.sheet.text),
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
    if (f === 'w') log.forEach((x, k) => {
      // Carry the new weight down to later, unfinished sets that matched the old value.
      if (k > j && !x.done && (x.w === '' || x.w == null || String(x.w) === String(old))) {
        x.w = el.value;
        const inp = document.querySelector(`[data-field="w"][data-i="${i}"][data-j="${k}"]`);
        if (inp) inp.value = el.value;
      }
    });
    save({ sync: false });
  } else if (f === 'rlo' || f === 'rhi' || f === 'rest') {
    const s = getSlots(el.dataset.where)[i];
    const v = parseInt(el.value, 10);
    if (!isNaN(v)) { if (f === 'rest') s.rest = v; else s.reps[f === 'rlo' ? 0 : 1] = v; persistFor(el.dataset.where); }
  } else if (f === 'day-name') { program().days[i].name = el.value; save(); }
  else if (f === 'profile-name') { profile().name = el.value; save(); }
  else if (f === 'gist-token') setGist({ token: el.value.trim() });
  else if (f === 'gist-id') setGist({ id: el.value.trim() });
  else if (f === 'sheet-q') { ui.sheet.q = el.value; const pos = el.selectionStart; renderSheet(); const n = document.querySelector('[data-field="sheet-q"]'); n.focus(); n.setSelectionRange(pos, pos); }
  else if (f === 'import-text') ui.sheet.text = el.value;
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
  else if (f === 'day-focus') { program().days[+el.dataset.i].focus = el.value; save(); render(); }
  else if (f === 'progress-ex') { ui.progressEx = el.value; render(); }
  else if (f === 'sheet-all') { ui.sheet.all = el.checked; renderSheet(); }
  else if (['rlo', 'rhi', 'rest', 'day-name', 'w', 'r'].includes(f)) { if (!['w', 'r'].includes(f)) render(); }
});

onSync(() => { if (ui.view === 'settings') render(); });

// ================= boot =================
render({ keepScroll: false });
if (state.active) keepAwake(true);
if (gist().token) syncNow().then(() => { ui.preview = null; render(); }).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
