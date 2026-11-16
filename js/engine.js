// Pure logic: availability, substitution, ratings, generation, progression.
import { EXERCISES, MUSCLES } from './exercises.js';

export const FOCUS = {
  push: ['chest', 'front_delts', 'side_delts', 'triceps'],
  pull: ['lats', 'upper_back', 'rear_delts', 'biceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  upper: ['chest', 'lats', 'upper_back', 'side_delts', 'biceps', 'triceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
  full: ['chest', 'lats', 'upper_back', 'quads', 'hamstrings', 'side_delts'],
};
export const FOCUS_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper', lower: 'Lower', full: 'Full Body' };

// Session effective-set targets per muscle [min, max] (advanced, each muscle trained 2x/week).
const SMALL = new Set(['side_delts', 'rear_delts', 'biceps', 'triceps', 'calves', 'abs', 'traps', 'forearms', 'adductors', 'front_delts']);
export const sessionTarget = m => (m === 'front_delts' ? [3, 9] : SMALL.has(m) ? [4, 9] : [6, 11]);
export const weeklyTarget = m => (SMALL.has(m) ? [8, 18] : [12, 22]);

// ---------- library ----------
export function library(custom = {}) {
  const lib = {};
  for (const e of EXERCISES) lib[e.id] = e;
  for (const [id, e] of Object.entries(custom)) lib[id] = { inc: 5, compound: false, len: 3, sfr: 3, ...e, id, custom: true };
  return lib;
}

// ---------- availability ----------
// ctx: { equip: Set of equipment ids, taken: Set of exercise or equipment ids, exclude: Set of exercise ids }
export function isAvailable(ex, ctx) {
  if (!ex) return false;
  if (ctx.exclude?.has(ex.id)) return false;
  if (ctx.taken?.has(ex.id)) return false;
  return ex.equip.every(q => q === 'bodyweight' || (ctx.equip.has(q) && !ctx.taken?.has(q)));
}

// ---------- similarity / substitution ----------
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const m in a) { na += a[m] ** 2; if (b[m]) dot += a[m] * b[m]; }
  for (const m in b) nb += b[m] ** 2;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function similarity(a, b) {
  let sim = cosine(a.muscles, b.muscles);
  if (a.pattern === b.pattern) sim += 0.15;
  if (a.compound !== b.compound) sim -= 0.1;
  return Math.min(1, sim);
}

export const quality = ex => (ex.len + ex.sfr) / 10; // 0.2 - 1.0

// Ranked alternatives for exercise `id`. `used` = ids already in the session.
export function substitutes(id, lib, ctx, used = new Set(), limit = 8) {
  const base = lib[id];
  if (!base) return [];
  return Object.values(lib)
    .filter(e => e.id !== id && !used.has(e.id) && isAvailable(e, ctx))
    .map(e => {
      const sim = similarity(base, e);
      return { ex: e, sim, score: sim * 0.7 + quality(e) * 0.3 };
    })
    .filter(r => r.sim >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Resolve a program day against equipment: keep what's available, auto-substitute the rest.
// Returns slots with { ex, sets, reps, rest, subbedFrom? , missing? }
export function resolveSlots(slots, lib, ctx) {
  const used = new Set();
  return slots.map(slot => {
    const ex = lib[slot.ex];
    if (ex && isAvailable(ex, ctx) && !used.has(ex.id)) {
      used.add(ex.id);
      return { ...slot };
    }
    const alt = substitutes(slot.ex, lib, ctx, used, 1)[0];
    if (alt) {
      used.add(alt.ex.id);
      return { ...slot, ex: alt.ex.id, subbedFrom: slot.ex };
    }
    return { ...slot, missing: true };
  });
}

// ---------- volume & ratings ----------
export function muscleSets(slots, lib, setKey = 'sets') {
  const out = {};
  for (const sl of slots) {
    const ex = lib[sl.ex];
    if (!ex || sl.missing) continue;
    const n = typeof setKey === 'function' ? setKey(sl) : sl[setKey];
    for (const [m, w] of Object.entries(ex.muscles)) {
      // Count synergist work at half credit at most; minor involvement (0.25) gets 0.25.
      const credit = w >= 1 ? 1 : w >= 0.75 ? 0.5 : w >= 0.5 ? 0.5 : 0.25;
      out[m] = (out[m] || 0) + n * credit;
    }
  }
  return out;
}

const bandScore = (v, [lo, hi]) => (v < lo ? v / lo : v > hi ? Math.max(0, 1 - (v - hi) / hi) : 1);

export function grade(score) {
  const g = [[93, 'A+'], [87, 'A'], [80, 'A-'], [75, 'B+'], [70, 'B'], [65, 'B-'], [60, 'C+'], [55, 'C'], [50, 'C-'], [0, 'D']];
  return g.find(([t]) => score >= t)[1];
}

// focus: array of muscle ids the session is meant to train.
export function rateSession(slots, lib, focus) {
  const live = slots.filter(s => lib[s.ex] && !s.missing);
  const sets = muscleSets(live, lib);
  const total = live.reduce((a, s) => a + s.sets, 0) || 1;
  const targets = focus?.length ? focus : Object.keys(sets).filter(m => sets[m] >= 3);

  const perMuscle = targets.map(m => ({ m, sets: +(sets[m] || 0).toFixed(1), target: sessionTarget(m), score: bandScore(sets[m] || 0, sessionTarget(m)) }));
  const coverage = perMuscle.length ? (perMuscle.reduce((a, p) => a + p.score, 0) / perMuscle.length) * 100 : 0;

  const avg = key => live.reduce((a, s) => a + lib[s.ex][key] * s.sets, 0) / total;
  const lengthened = ((avg('len') - 1) / 4) * 100;
  const sfr = ((avg('sfr') - 1) / 4) * 100;

  // Redundancy penalty: same movement pattern 3+ times.
  const patterns = {};
  live.forEach(s => (patterns[lib[s.ex].pattern] = (patterns[lib[s.ex].pattern] || 0) + 1));
  const redundancy = Object.values(patterns).filter(n => n >= 3).length * 5;

  const overall = Math.max(0, Math.round(coverage * 0.4 + lengthened * 0.3 + sfr * 0.3 - redundancy));

  const notes = [];
  perMuscle.forEach(p => {
    if (p.sets < p.target[0]) notes.push(`${MUSCLES[p.m]} is under-dosed (${p.sets} of ${p.target[0]}+ sets).`);
    if (p.sets > p.target[1]) notes.push(`${MUSCLES[p.m]} volume is high (${p.sets} sets); consider trimming.`);
  });
  const weakLen = live.filter(s => lib[s.ex].len <= 2).map(s => lib[s.ex].name);
  if (weakLen.length) notes.push(`Short-range emphasis: ${weakLen.join(', ')}. A stretch-biased swap would score higher.`);
  const lowSfr = live.filter(s => lib[s.ex].sfr <= 2).map(s => lib[s.ex].name);
  if (lowSfr.length) notes.push(`High fatigue cost: ${lowSfr.join(', ')}.`);
  if (redundancy) notes.push('Three or more exercises share one movement pattern.');

  return {
    overall, grade: grade(overall),
    coverage: Math.round(coverage), lengthened: Math.round(lengthened), sfr: Math.round(sfr),
    perMuscle, allSets: sets, notes, minutes: estimateMinutes(live, lib),
  };
}

export function rateExercise(ex) {
  const q = Math.round((((ex.len - 1) / 4) * 0.5 + ((ex.sfr - 1) / 4) * 0.5) * 100);
  return { score: q, grade: grade(q) };
}

// scale: converts one pass through the rotation to a 7-day week (e.g. 0.7 for a 10-day cycle).
export function rateWeek(days, lib, scale = 1) {
  const total = {};
  for (const d of days) {
    const s = muscleSets(d, lib);
    for (const m in s) total[m] = (total[m] || 0) + s[m] * scale;
  }
  const rows = Object.keys(MUSCLES)
    .filter(m => !['forearms', 'lower_back'].includes(m))
    .map(m => ({ m, sets: +(total[m] || 0).toFixed(1), target: weeklyTarget(m), score: bandScore(total[m] || 0, weeklyTarget(m)) }));
  const majors = rows.filter(r => !['abs', 'adductors', 'traps', 'front_delts'].includes(r.m));
  const score = Math.round((majors.reduce((a, r) => a + r.score, 0) / majors.length) * 100);
  return { rows, score, grade: grade(score) };
}

export function estimateMinutes(slots, lib) {
  let sec = 0;
  for (const s of slots) {
    const ex = lib[s.ex];
    if (!ex) continue;
    sec += s.sets * (s.rest + 40);
    if (ex.compound) sec += 180; // warm-ups
  }
  return Math.round(sec / 60);
}

// ---------- on-the-fly generator ----------
const repScheme = ex =>
  ex.compound ? { reps: [6, 10], rest: 150 }
  : ['lateral_raise', 'calf', 'rear_delt'].includes(ex.pattern) ? { reps: [12, 20], rest: 75 }
  : { reps: [10, 15], rest: 90 };

// opts: { muscles: [...], minutes, seed }
export function generate(opts, lib, ctx) {
  const muscles = opts.muscles;
  const minutes = opts.minutes || 60;
  let seed = opts.seed ?? Date.now();
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  const done = {};
  const slots = [];
  const usedIds = new Set();
  const usedPatterns = {};
  const direct = new Set();
  // Phase 0 fills each muscle to the bottom of its range; phase 1 uses leftover time to reach mid-range.
  let phase = 0;
  const goal = m => { const [lo, hi] = sessionTarget(m); return phase ? Math.round((lo + hi) / 2) : lo + 1; };
  const deficit = m => goal(m) - (done[m] || 0);
  const isOpen = m => deficit(m) > 1 || (m !== 'front_delts' && !direct.has(m) && done[m] !== 99);

  for (let guard = 0; guard < 24; guard++) {
    const open = muscles.filter(isOpen).sort((a, b) => Math.max(deficit(b), 1.5) - Math.max(deficit(a), 1.5));
    if (!open.length) { if (phase) break; phase = 1; continue; }
    const m = open[0];
    const cands = Object.values(lib).filter(e => (e.muscles[m] || 0) >= 1 && !usedIds.has(e.id) && isAvailable(e, ctx));
    if (!cands.length) { done[m] = 99; direct.add(m); continue; }
    const needCompound = !slots.some(s => (lib[s.ex].muscles[m] || 0) >= 1);
    const scored = cands.map(e => {
      let sc = quality(e);
      // Credit for also hitting other open muscles; penalty for heavy work on non-target muscles.
      for (const [mm, w] of Object.entries(e.muscles)) {
        if (mm === m) continue;
        if (muscles.includes(mm) && isOpen(mm)) sc += 0.08 * w;
        else if (!muscles.includes(mm) && w >= 0.75) sc -= 0.1;
      }
      if (needCompound && e.compound && ['chest', 'lats', 'upper_back', 'quads', 'hamstrings', 'glutes'].includes(m)) sc += 0.25;
      sc -= (usedPatterns[e.pattern] || 0) * 0.3;
      sc += rand() * 0.12;
      return { e, sc };
    }).sort((a, b) => b.sc - a.sc);
    const ex = scored[0].e;
    const { reps, rest } = repScheme(ex);
    const sets = Math.max(2, Math.min(ex.compound ? 4 : 3, Math.ceil(deficit(m))));
    const slot = { ex: ex.id, sets, reps, rest };
    if (estimateMinutes([...slots, slot], lib) > minutes) {
      if (sets > 2 && estimateMinutes([...slots, { ...slot, sets: 2 }], lib) <= minutes) slot.sets = 2;
      else break;
    }
    slots.push(slot);
    usedIds.add(ex.id);
    usedPatterns[ex.pattern] = (usedPatterns[ex.pattern] || 0) + 1;
    for (const [mm, w] of Object.entries(ex.muscles)) if (w >= 1) direct.add(mm);
    for (const [mm, w] of Object.entries(ex.muscles)) done[mm] = (done[mm] || 0) + slot.sets * (w >= 1 ? 1 : w >= 0.5 ? 0.5 : 0.25);
  }
  // Compounds first, then by muscle list order.
  const order = id => muscles.findIndex(m => (lib[id].muscles[m] || 0) >= 1);
  slots.sort((a, b) => (lib[b.ex].compound - lib[a.ex].compound) || (order(a.ex) - order(b.ex)));
  return slots;
}

// ---------- mesocycle & progression ----------
// 5-week block: RIR 3,2,1,0-1 then deload.
export const MESO = [
  { week: 1, rir: '3', label: 'Week 1 · 3 RIR' },
  { week: 2, rir: '2', label: 'Week 2 · 2 RIR' },
  { week: 3, rir: '1', label: 'Week 3 · 1 RIR' },
  { week: 4, rir: '0-1', label: 'Week 4 · 0–1 RIR (last set to failure)' },
  { week: 5, rir: '4', label: 'Week 5 · Deload', deload: true },
];

export function mesoWeek(sessionsInMeso, daysPerWeek) {
  const w = Math.floor(sessionsInMeso / Math.max(1, daysPerWeek)) % MESO.length;
  return { ...MESO[w], idx: w };
}

// A program may define its own cycles: [{ label, rir?, effort?, deload? }]. Otherwise the 5-week block applies.
export const cyclesOf = p => (p?.cycles?.length ? p.cycles : MESO);

// Days that are rest days in the program's own rotation.
export const isRestDay = d => !!d?.rest;
export const trainingDays = p => p.days.filter(d => !d.rest);

// Apply a slot's per-cycle overrides (sets, reps, rest, ex, tech, note) for cycle index `idx`.
export function slotFor(slot, idx) {
  const o = slot.byCycle?.[idx];
  if (!o) return { ...slot };
  const out = { ...slot, ...o };
  delete out.byCycle;
  out.byCycle = slot.byCycle;
  return out;
}

// Label for the rep column: "reps" unless the exercise is logged in seconds, passes, etc.
export const repUnit = ex => ex?.unit || 'reps';
export const fmtRange = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

export const roundTo = (w, step) => (step ? Math.round(w / step) * step : w);
export const e1rm = (w, r) => (w && r ? w * (1 + r / 30) : 0);

// history: array of past performances of this exercise, newest first: [{ sets: [{w, r}] }]
export function suggest(ex, slot, history, week) {
  const [lo, hi] = slot.reps;
  // Programs with their own cycles set deload volume per slot, so only the built-in block halves sets.
  const sets = week?.deload && !week.custom ? Math.max(1, Math.ceil(slot.sets / 2)) : slot.sets;
  const u = repUnit(ex);
  const last = history[0];
  if (!last || !last.sets.length) {
    return { sets, weight: null, reps: lo, note: u === 'reps' ? `First time: pick a load you can lift for ${hi} reps, ${week?.effort ? 'at ' + week.effort : `stopping ${week?.rir || 2} reps short of failure`}.` : `First time: pick a load you can hold for about ${lo} ${u}.` };
  }
  const work = last.sets.filter(s => s.w != null && s.r);
  if (!work.length) return { sets, weight: null, reps: lo, note: 'No logged weight last time.' };
  const topW = Math.max(...work.map(s => s.w));
  const atTop = work.filter(s => s.w === topW);
  const minReps = Math.min(...atTop.map(s => s.r));
  const inc = ex.inc ?? 5;

  if (week?.deload) {
    return { sets, weight: topW ? roundTo(topW * 0.9, inc || 1) : null, reps: lo, note: week.custom ? 'Deload: about 90% load, easy reps, no intensity techniques.' : 'Deload: half the sets, about 90% load, easy reps.' };
  }
  if (minReps >= hi && inc) {
    return { sets, weight: topW + inc, reps: lo, note: `Hit ${hi}+ ${u} on every set last time. Add ${inc} lb.` };
  }
  if (!inc) {
    return { sets, weight: topW || null, reps: Math.min(hi + 5, minReps + 1), note: `Beat last time: aim for ${minReps + 1}+ ${u}.` };
  }
  const target = Math.min(hi, minReps + 1);
  return { sets, weight: topW, reps: target, note: `Same load, aim for ${target} ${u} (last: ${atTop.map(s => s.r).join('/')}).` };
}

export function warmups(ex, weight) {
  if (!ex.compound || !weight || weight < 40) return [];
  const step = ex.inc >= 10 ? 5 : ex.inc || 5;
  return [[0.5, 8], [0.7, 4], [0.85, 2]]
    .map(([p, r]) => ({ w: roundTo(weight * p, step), r }))
    .filter((s, i, a) => s.w > 0 && (i === 0 || s.w !== a[i - 1].w));
}

// ---------- intensity techniques ----------
// sub: the kind of extra row the technique adds after the working set.
// rest: seconds between those rows. rows: how many to add. reps: default reps per extra row.
export const TECHNIQUES = {
  drop: { label: 'Drop set', short: 'Drop set', sub: true, rows: 1, rest: 0, pct: 25, desc: 'At failure, strip ~25% of the weight and go again with no rest.' },
  mech: { label: 'Mechanical drop set', short: 'Mech drop', sub: true, rows: 1, rest: 0, desc: 'At failure, keep the weight and switch to an easier position or shorter range (e.g. incline → flat, full → partial).' },
  myo: { label: 'Myo-reps', short: 'Myo-reps', sub: true, rows: 3, rest: 15, reps: 4, desc: 'Activation set near failure, then mini-sets of ~4 reps with 15 sec rest until you can’t get 4.' },
  rp: { label: 'Rest-pause', short: 'Rest-pause', sub: true, rows: 2, rest: 15, desc: 'Go to failure, rest 15 sec, go to failure again. Repeat once more.' },
  cluster: { label: 'Cluster set', short: 'Cluster', sub: true, rows: 2, rest: 20, reps: 2, desc: 'Break one heavy set into mini-sets with 15–20 sec between them (e.g. 3 + 2 + 2).' },
  partials: { label: 'Lengthened partials', short: 'Partials', sub: true, rows: 1, rest: 0, desc: 'At failure, keep going with partial reps in the stretched half of the range. Log the partial reps.' },
  failure: { label: 'Take to failure', short: 'Failure', desc: 'Last rep you can complete with good form. Use on the last set, mostly on machines and cables.' },
  eccentric: { label: 'Slow eccentric (3–4 sec)', short: 'Slow ecc', desc: 'Lower the weight over 3–4 seconds on every rep.' },
  pause: { label: 'Stretch pause', short: 'Stretch pause', desc: 'Pause 1–2 sec in the deepest stretch on every rep, no bounce.' },
  onehalf: { label: '1½ reps', short: '1½ reps', desc: 'Full rep plus a half rep in the stretched range counts as one.' },
  superset: { label: 'Superset next exercise', short: 'Superset', desc: 'Go straight to the next exercise without resting.' },
};
export const techOf = key => TECHNIQUES[key] || null;
