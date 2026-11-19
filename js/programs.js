// Default program: 6-day Push/Pull/Legs, advanced hypertrophy.
// Slot: { ex, sets, reps: [low, high], rest: seconds, group?: superset/circuit label }
// Grouped slots go back to back: rest 0 on every slot but the last in the group.
// rev: bump when the default changes; app.js upgrades the stored copy in place.

const s = (ex, sets, lo, hi, rest, group) => ({ ex, sets, reps: [lo, hi], rest, ...(group && { group }) });

// Ab circuit: 3 exercises back to back, 2 rounds, 90 sec between rounds.
const absA = [s('cable_crunch', 2, 10, 15, 0, 'Abs 1'), s('hanging_leg_raise', 2, 10, 15, 0, 'Abs 2'), s('pallof_press', 2, 10, 12, 90, 'Abs 3')];
const absB = [s('decline_crunch', 2, 10, 15, 0, 'Abs 1'), s('ab_wheel', 2, 8, 12, 0, 'Abs 2'), s('pallof_press', 2, 10, 12, 90, 'Abs 3')];

export const DEFAULT_PROGRAM = {
  id: 'ppl6',
  name: 'PPL x2 — Hypertrophy',
  rev: 3,
  days: [
    {
      id: 'push_a', name: 'Push A (Chest)', focus: 'push', slots: [
        s('db_incline', 3, 6, 10, 180),
        s('machine_chest_press', 3, 8, 12, 150),
        s('cable_fly', 3, 10, 15, 90),
        s('dip', 2, 8, 12, 120),
        s('cable_lateral', 4, 12, 15, 0, 'A1'),
        s('cable_oh_ext', 3, 10, 15, 90, 'A2'),
        s('rope_pushdown', 3, 12, 15, 0, 'B1'),
        s('cable_rear_fly', 3, 12, 20, 60, 'B2'),
        ...absA,
      ],
    },
    {
      id: 'pull_a', name: 'Pull A (Width)', focus: 'pull', slots: [
        s('lat_pulldown', 3, 8, 12, 120),
        s('chest_sup_row', 3, 8, 12, 120),
        s('db_row', 3, 8, 12, 90),
        s('cable_pullover', 3, 12, 15, 75),
        s('incline_db_curl', 3, 10, 12, 0, 'A1'),
        s('reverse_pec_deck', 3, 12, 20, 75, 'A2'),
        s('hammer_curl', 3, 10, 12, 0, 'B1'),
        s('cable_shrug', 3, 12, 15, 60, 'B2'),
        ...absB,
      ],
    },
    {
      id: 'legs_a', name: 'Legs A (Quads)', focus: 'legs', slots: [
        s('hack_squat', 3, 6, 10, 180),
        s('rdl', 3, 8, 10, 150),
        s('hip_thrust', 3, 8, 12, 120),
        s('leg_ext', 3, 10, 15, 0, 'A1'),
        s('seated_curl', 3, 10, 15, 75, 'A2'),
        s('adductor_machine', 2, 12, 15, 0, 'B1'),
        s('abductor_machine', 2, 12, 20, 60, 'B2'),
        s('standing_calf', 4, 10, 15, 60),
      ],
    },
    {
      id: 'push_b', name: 'Push B (Shoulders)', focus: 'push', slots: [
        s('machine_ohp', 3, 8, 12, 120),
        s('bb_bench', 3, 5, 8, 180),
        s('machine_incline', 3, 8, 12, 120),
        s('low_high_fly', 3, 12, 15, 75),
        s('machine_lateral', 4, 12, 20, 0, 'A1'),
        s('ez_skull', 3, 10, 12, 75, 'A2'),
        s('bar_pushdown', 2, 12, 15, 0, 'B1'),
        s('face_pull', 2, 15, 20, 60, 'B2'),
        ...absA,
      ],
    },
    {
      id: 'pull_b', name: 'Pull B (Thickness)', focus: 'pull', slots: [
        s('pullup', 3, 6, 10, 150),
        s('cable_row', 3, 10, 12, 120),
        s('single_arm_pulldown', 2, 12, 15, 75),
        s('preacher_curl', 2, 10, 12, 75),
        s('bayesian_curl', 3, 10, 15, 0, 'A1'),
        s('face_pull', 3, 15, 20, 60, 'A2'),
        s('rope_hammer', 3, 10, 15, 0, 'B1'),
        s('db_shrug', 3, 10, 15, 60, 'B2'),
        ...absB,
      ],
    },
    {
      id: 'legs_b', name: 'Legs B (Posterior)', focus: 'legs', slots: [
        s('lying_curl', 3, 10, 15, 90),
        s('bulgarian', 3, 8, 12, 120),
        s('leg_press', 3, 10, 15, 150),
        s('back_ext', 3, 10, 15, 75),
        s('cable_pull_through', 2, 12, 15, 75),
        s('leg_ext', 2, 12, 15, 0, 'A1'),
        s('seated_curl', 2, 10, 15, 60, 'A2'),
        s('leg_press_calf', 4, 12, 20, 60),
        ...absA,
      ],
    },
  ],
};
