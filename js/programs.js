// Default program: 6-day Push/Pull/Legs, advanced hypertrophy.
// Slot: { ex: exercise id, sets, reps: [low, high], rest: seconds }

const s = (ex, sets, lo, hi, rest) => ({ ex, sets, reps: [lo, hi], rest });

export const DEFAULT_PROGRAM = {
  id: 'ppl6',
  name: 'PPL x2 — Hypertrophy',
  days: [
    {
      id: 'push_a', name: 'Push A (Chest)', focus: 'push', slots: [
        s('db_incline', 3, 6, 10, 180),
        s('machine_chest_press', 3, 8, 12, 150),
        s('cable_fly', 3, 10, 15, 90),
        s('cable_lateral', 4, 12, 15, 75),
        s('cable_oh_ext', 3, 10, 15, 90),
        s('rope_pushdown', 2, 12, 15, 75),
      ],
    },
    {
      id: 'pull_a', name: 'Pull A (Width)', focus: 'pull', slots: [
        s('lat_pulldown', 3, 8, 12, 150),
        s('chest_sup_row', 3, 8, 12, 150),
        s('cable_pullover', 2, 12, 15, 90),
        s('reverse_pec_deck', 3, 12, 20, 75),
        s('incline_db_curl', 3, 10, 12, 90),
        s('hammer_curl', 2, 10, 12, 75),
      ],
    },
    {
      id: 'legs_a', name: 'Legs A (Quads)', focus: 'legs', slots: [
        s('hack_squat', 3, 6, 10, 180),
        s('rdl', 3, 8, 10, 180),
        s('leg_ext', 3, 10, 15, 90),
        s('seated_curl', 3, 10, 15, 90),
        s('adductor_machine', 2, 12, 15, 75),
        s('standing_calf', 4, 10, 15, 75),
        s('cable_crunch', 3, 10, 15, 60),
      ],
    },
    {
      id: 'push_b', name: 'Push B (Shoulders)', focus: 'push', slots: [
        s('machine_ohp', 3, 8, 12, 150),
        s('bb_bench', 3, 5, 8, 180),
        s('low_high_fly', 3, 12, 15, 90),
        s('machine_lateral', 4, 12, 20, 75),
        s('dip', 2, 8, 12, 120),
        s('ez_skull', 3, 10, 12, 90),
      ],
    },
    {
      id: 'pull_b', name: 'Pull B (Thickness)', focus: 'pull', slots: [
        s('pullup', 3, 6, 10, 150),
        s('cable_row', 3, 10, 12, 150),
        s('single_arm_pulldown', 2, 12, 15, 75),
        s('face_pull', 3, 15, 20, 75),
        s('bayesian_curl', 3, 10, 15, 75),
        s('preacher_curl', 2, 10, 12, 75),
        s('db_shrug', 3, 10, 15, 75),
      ],
    },
    {
      id: 'legs_b', name: 'Legs B (Posterior)', focus: 'legs', slots: [
        s('lying_curl', 3, 10, 15, 90),
        s('bulgarian', 3, 8, 12, 120),
        s('leg_press', 3, 10, 15, 150),
        s('back_ext', 3, 10, 15, 90),
        s('leg_ext', 2, 12, 15, 75),
        s('leg_press_calf', 4, 12, 20, 75),
        s('hanging_leg_raise', 3, 10, 15, 60),
      ],
    },
  ],
};
