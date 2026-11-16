// Exercise library.
// muscles: stimulus weight per muscle (1 = prime mover, 0.5 = significant synergist, 0.25 = minor).
// equip: every item listed is required. "bodyweight" is always available.
// len: lengthened-position bias, 1-5 (5 = heavy loading at long muscle length).
// sfr: stimulus-to-fatigue ratio, 1-5 (5 = lots of growth stimulus for little systemic/joint cost).
// compound: multi-joint lift (gets warm-up sets, slower progression, longer rest).
// inc: load increment in lb for progression.

export const MUSCLES = {
  chest: 'Chest', front_delts: 'Front Delts', side_delts: 'Side Delts', rear_delts: 'Rear Delts',
  lats: 'Lats', upper_back: 'Upper Back', traps: 'Traps', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes',
  adductors: 'Adductors', calves: 'Calves', abs: 'Abs', lower_back: 'Lower Back',
};

export const EQUIPMENT = {
  barbell: 'Barbell', rack: 'Squat Rack', bench: 'Flat Bench', incline_bench: 'Adjustable Bench',
  dumbbell: 'Dumbbells', ez_bar: 'EZ Bar', cable: 'Cable Station', smith: 'Smith Machine',
  pullup_bar: 'Pull-up Bar', dip_station: 'Dip Station', leg_press: 'Leg Press',
  hack_squat: 'Hack Squat', pendulum: 'Pendulum Squat', leg_ext: 'Leg Extension',
  seated_leg_curl: 'Seated Leg Curl', lying_leg_curl: 'Lying Leg Curl', pec_deck: 'Pec Deck / Rear Delt Fly',
  chest_press_machine: 'Chest Press Machine', shoulder_press_machine: 'Shoulder Press Machine',
  lateral_raise_machine: 'Lateral Raise Machine', lat_pulldown: 'Lat Pulldown',
  cable_row: 'Seated Cable Row', chest_supported_row: 'Chest-Supported Row Machine',
  preacher: 'Preacher Bench', calf_machine: 'Calf Raise Machine', back_extension: '45° Back Extension',
  hip_adductor: 'Hip Adductor Machine', hip_abductor: 'Hip Abductor Machine', assisted_pullup: 'Assisted Pull-up Machine',
  band: 'Resistance Bands',
};

export const PATTERNS = {
  horizontal_press: 'Horizontal Press', incline_press: 'Incline Press', vertical_press: 'Overhead Press',
  chest_fly: 'Chest Fly', dip: 'Dip', lateral_raise: 'Lateral Raise', triceps_overhead: 'Overhead Triceps',
  triceps_pushdown: 'Triceps Pushdown', triceps_press: 'Triceps Press', vertical_pull: 'Vertical Pull',
  horizontal_pull: 'Row', pullover: 'Pullover', rear_delt: 'Rear Delt', shrug: 'Shrug',
  biceps_curl: 'Curl', biceps_stretch: 'Stretch Curl', hammer_curl: 'Hammer Curl',
  squat: 'Squat', leg_press: 'Leg Press', lunge: 'Lunge / Split Squat', leg_ext: 'Knee Extension',
  hinge: 'Hip Hinge', leg_curl: 'Knee Flexion', hip_thrust: 'Hip Extension', adduction: 'Adduction',
  abduction: 'Abduction', calf: 'Calf Raise', abs_flexion: 'Ab Flexion', abs_anti: 'Ab Anti-extension',
};

const X = (id, name, pattern, muscles, equip, len, sfr, compound = false, inc = 5) =>
  ({ id, name, pattern, muscles, equip, len, sfr, compound, inc });

export const EXERCISES = [
  // ---- Chest: horizontal press
  X('bb_bench', 'Barbell Bench Press', 'horizontal_press', { chest: 1, triceps: 0.5, front_delts: 0.5 }, ['barbell', 'bench', 'rack'], 3, 3, true),
  X('db_bench', 'Dumbbell Bench Press', 'horizontal_press', { chest: 1, triceps: 0.5, front_delts: 0.5 }, ['dumbbell', 'bench'], 4, 3, true),
  X('smith_bench', 'Smith Machine Bench Press', 'horizontal_press', { chest: 1, triceps: 0.5, front_delts: 0.5 }, ['smith', 'bench'], 3, 4, true),
  X('machine_chest_press', 'Machine Chest Press', 'horizontal_press', { chest: 1, triceps: 0.5, front_delts: 0.5 }, ['chest_press_machine'], 4, 5, true),
  X('deficit_pushup', 'Deficit Push-up', 'horizontal_press', { chest: 1, triceps: 0.5, front_delts: 0.5, abs: 0.25 }, ['bodyweight'], 4, 4, true, 0),
  // ---- Chest: incline press
  X('bb_incline', 'Incline Barbell Press', 'incline_press', { chest: 1, front_delts: 0.75, triceps: 0.5 }, ['barbell', 'incline_bench', 'rack'], 3, 3, true),
  X('db_incline', 'Incline Dumbbell Press', 'incline_press', { chest: 1, front_delts: 0.75, triceps: 0.5 }, ['dumbbell', 'incline_bench'], 4, 4, true),
  X('smith_incline', 'Incline Smith Machine Press', 'incline_press', { chest: 1, front_delts: 0.75, triceps: 0.5 }, ['smith', 'incline_bench'], 3, 5, true),
  X('machine_incline', 'Incline Machine Press', 'incline_press', { chest: 1, front_delts: 0.75, triceps: 0.5 }, ['chest_press_machine'], 4, 5, true),
  // ---- Chest: fly / dip
  X('cable_fly', 'Cable Crossover (Mid)', 'chest_fly', { chest: 1, front_delts: 0.25 }, ['cable'], 4, 5),
  X('low_high_fly', 'Low-to-High Cable Fly', 'chest_fly', { chest: 1, front_delts: 0.5 }, ['cable'], 4, 5),
  X('pec_deck_fly', 'Pec Deck Fly', 'chest_fly', { chest: 1, front_delts: 0.25 }, ['pec_deck'], 4, 5),
  X('db_fly', 'Dumbbell Fly', 'chest_fly', { chest: 1, front_delts: 0.25 }, ['dumbbell', 'bench'], 5, 3, false, 5),
  X('band_fly', 'Band Chest Fly', 'chest_fly', { chest: 1 }, ['band'], 2, 4, false, 0),
  X('dip', 'Chest-Lean Dip', 'dip', { chest: 1, triceps: 0.75, front_delts: 0.5 }, ['dip_station'], 5, 3, true),
  // ---- Shoulders
  X('db_ohp', 'Seated Dumbbell Shoulder Press', 'vertical_press', { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, ['dumbbell', 'incline_bench'], 3, 3, true),
  X('bb_ohp', 'Standing Barbell Overhead Press', 'vertical_press', { front_delts: 1, side_delts: 0.5, triceps: 0.5, abs: 0.25 }, ['barbell', 'rack'], 3, 2, true),
  X('machine_ohp', 'Machine Shoulder Press', 'vertical_press', { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, ['shoulder_press_machine'], 3, 5, true),
  X('smith_ohp', 'Smith Machine Shoulder Press', 'vertical_press', { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, ['smith', 'incline_bench'], 3, 4, true),
  X('cable_lateral', 'Cable Lateral Raise (Behind Body)', 'lateral_raise', { side_delts: 1 }, ['cable'], 5, 5, false, 2.5),
  X('db_lateral', 'Dumbbell Lateral Raise', 'lateral_raise', { side_delts: 1 }, ['dumbbell'], 2, 4, false, 5),
  X('lean_lateral', 'Lean-Away Dumbbell Lateral Raise', 'lateral_raise', { side_delts: 1 }, ['dumbbell'], 4, 4, false, 5),
  X('machine_lateral', 'Machine Lateral Raise', 'lateral_raise', { side_delts: 1 }, ['lateral_raise_machine'], 4, 5, false, 5),
  X('band_lateral', 'Band Lateral Raise', 'lateral_raise', { side_delts: 1 }, ['band'], 1, 4, false, 0),
  X('reverse_pec_deck', 'Reverse Pec Deck', 'rear_delt', { rear_delts: 1, upper_back: 0.5 }, ['pec_deck'], 4, 5, false, 5),
  X('cable_rear_fly', 'Cable Reverse Fly', 'rear_delt', { rear_delts: 1, upper_back: 0.5 }, ['cable'], 4, 5, false, 2.5),
  X('face_pull', 'Face Pull', 'rear_delt', { rear_delts: 1, upper_back: 0.5, traps: 0.25 }, ['cable'], 3, 4, false, 5),
  X('db_rear_fly', 'Chest-Supported Dumbbell Rear Delt Fly', 'rear_delt', { rear_delts: 1, upper_back: 0.5 }, ['dumbbell', 'incline_bench'], 3, 4, false, 5),
  X('band_pull_apart', 'Band Pull-Apart', 'rear_delt', { rear_delts: 1, upper_back: 0.5 }, ['band'], 2, 4, false, 0),
  // ---- Triceps
  X('cable_oh_ext', 'Overhead Cable Triceps Extension', 'triceps_overhead', { triceps: 1 }, ['cable'], 5, 5, false, 5),
  X('db_oh_ext', 'Seated Dumbbell Overhead Extension', 'triceps_overhead', { triceps: 1 }, ['dumbbell'], 5, 4, false, 5),
  X('ez_skull', 'EZ-Bar Skull Crusher', 'triceps_overhead', { triceps: 1 }, ['ez_bar', 'bench'], 4, 3, false, 5),
  X('rope_pushdown', 'Rope Pushdown', 'triceps_pushdown', { triceps: 1 }, ['cable'], 2, 5, false, 5),
  X('bar_pushdown', 'Straight-Bar Pushdown', 'triceps_pushdown', { triceps: 1 }, ['cable'], 2, 5, false, 5),
  X('band_pushdown', 'Band Pushdown', 'triceps_pushdown', { triceps: 1 }, ['band'], 1, 4, false, 0),
  X('close_grip_bench', 'Close-Grip Bench Press', 'triceps_press', { triceps: 1, chest: 0.5, front_delts: 0.25 }, ['barbell', 'bench', 'rack'], 3, 3, true),
  X('jm_press', 'Smith Machine JM Press', 'triceps_press', { triceps: 1, chest: 0.25 }, ['smith', 'bench'], 4, 4, true),
  X('diamond_pushup', 'Close-Grip Push-up', 'triceps_press', { triceps: 1, chest: 0.5, front_delts: 0.25 }, ['bodyweight'], 3, 3, true, 0),
  // ---- Back: vertical pull
  X('pullup', 'Pull-up', 'vertical_pull', { lats: 1, biceps: 0.5, upper_back: 0.5 }, ['pullup_bar'], 4, 3, true, 5),
  X('chinup', 'Chin-up', 'vertical_pull', { lats: 1, biceps: 0.75, upper_back: 0.25 }, ['pullup_bar'], 4, 3, true, 5),
  X('assisted_pullup', 'Assisted Pull-up', 'vertical_pull', { lats: 1, biceps: 0.5, upper_back: 0.5 }, ['assisted_pullup'], 4, 4, true, 5),
  X('lat_pulldown', 'Wide-Grip Lat Pulldown', 'vertical_pull', { lats: 1, biceps: 0.5, upper_back: 0.5 }, ['lat_pulldown'], 4, 5, true),
  X('ng_pulldown', 'Neutral-Grip Lat Pulldown', 'vertical_pull', { lats: 1, biceps: 0.5, upper_back: 0.25 }, ['lat_pulldown'], 4, 5, true),
  X('single_arm_pulldown', 'Single-Arm Cable Pulldown', 'vertical_pull', { lats: 1, biceps: 0.25 }, ['cable'], 5, 5, false, 5),
  X('band_pulldown', 'Band Lat Pulldown', 'vertical_pull', { lats: 1, biceps: 0.5 }, ['band'], 2, 3, false, 0),
  // ---- Back: rows
  X('chest_sup_row', 'Chest-Supported Machine Row', 'horizontal_pull', { upper_back: 1, lats: 0.75, rear_delts: 0.5, biceps: 0.5 }, ['chest_supported_row'], 4, 5, true),
  X('db_incline_row', 'Chest-Supported Dumbbell Row', 'horizontal_pull', { upper_back: 1, lats: 0.75, rear_delts: 0.5, biceps: 0.5 }, ['dumbbell', 'incline_bench'], 4, 4, true),
  X('cable_row', 'Seated Cable Row', 'horizontal_pull', { upper_back: 1, lats: 0.75, rear_delts: 0.25, biceps: 0.5 }, ['cable_row'], 5, 5, true),
  X('db_row', 'Single-Arm Dumbbell Row', 'horizontal_pull', { lats: 1, upper_back: 0.75, rear_delts: 0.25, biceps: 0.5 }, ['dumbbell', 'bench'], 4, 4, true),
  X('bb_row', 'Barbell Row', 'horizontal_pull', { upper_back: 1, lats: 0.75, rear_delts: 0.5, biceps: 0.5, lower_back: 0.5 }, ['barbell'], 3, 2, true),
  X('pendlay_row', 'Pendlay Row', 'horizontal_pull', { upper_back: 1, lats: 0.75, rear_delts: 0.5, lower_back: 0.5 }, ['barbell'], 3, 2, true),
  X('kroc_row', 'Kroc Row', 'horizontal_pull', { lats: 1, upper_back: 0.75, biceps: 0.5, forearms: 0.25 }, ['dumbbell', 'bench'], 4, 3, true),
  X('inverted_row', 'Inverted Row', 'horizontal_pull', { upper_back: 1, lats: 0.5, biceps: 0.5, rear_delts: 0.5 }, ['smith'], 3, 4, true, 0),
  X('band_row', 'Band Row', 'horizontal_pull', { upper_back: 1, lats: 0.5, biceps: 0.5 }, ['band'], 2, 3, false, 0),
  X('cable_pullover', 'Cable Lat Pullover', 'pullover', { lats: 1, triceps: 0.25 }, ['cable'], 5, 5, false, 5),
  X('db_pullover', 'Dumbbell Pullover', 'pullover', { lats: 1, chest: 0.5, triceps: 0.25 }, ['dumbbell', 'bench'], 5, 3, false, 5),
  X('db_shrug', 'Dumbbell Shrug', 'shrug', { traps: 1, forearms: 0.25 }, ['dumbbell'], 3, 4, false, 5),
  X('cable_shrug', 'Cable Shrug', 'shrug', { traps: 1 }, ['cable'], 3, 5, false, 5),
  X('bb_shrug', 'Barbell Shrug', 'shrug', { traps: 1, forearms: 0.25 }, ['barbell'], 2, 4, false, 10),
  // ---- Biceps
  X('incline_db_curl', 'Incline Dumbbell Curl', 'biceps_stretch', { biceps: 1 }, ['dumbbell', 'incline_bench'], 5, 4, false, 5),
  X('bayesian_curl', 'Bayesian Cable Curl', 'biceps_stretch', { biceps: 1 }, ['cable'], 5, 5, false, 2.5),
  X('preacher_curl', 'EZ-Bar Preacher Curl', 'biceps_curl', { biceps: 1 }, ['ez_bar', 'preacher'], 5, 5, false, 5),
  X('db_preacher', 'Dumbbell Preacher Curl', 'biceps_curl', { biceps: 1 }, ['dumbbell', 'preacher'], 5, 5, false, 5),
  X('ez_curl', 'EZ-Bar Curl', 'biceps_curl', { biceps: 1, forearms: 0.25 }, ['ez_bar'], 3, 4, false, 5),
  X('bb_curl', 'Barbell Curl', 'biceps_curl', { biceps: 1, forearms: 0.25 }, ['barbell'], 3, 4, false, 5),
  X('cable_curl', 'Cable Curl', 'biceps_curl', { biceps: 1 }, ['cable'], 3, 5, false, 5),
  X('db_curl', 'Dumbbell Curl', 'biceps_curl', { biceps: 1, forearms: 0.25 }, ['dumbbell'], 3, 4, false, 5),
  X('band_curl', 'Band Curl', 'biceps_curl', { biceps: 1 }, ['band'], 1, 4, false, 0),
  X('hammer_curl', 'Hammer Curl', 'hammer_curl', { biceps: 0.75, forearms: 1 }, ['dumbbell'], 3, 4, false, 5),
  X('rope_hammer', 'Rope Hammer Curl', 'hammer_curl', { biceps: 0.75, forearms: 1 }, ['cable'], 3, 5, false, 5),
  // ---- Quads
  X('bb_squat', 'Barbell Back Squat', 'squat', { quads: 1, glutes: 0.75, adductors: 0.5, lower_back: 0.25 }, ['barbell', 'rack'], 4, 2, true, 10),
  X('front_squat', 'Front Squat', 'squat', { quads: 1, glutes: 0.5, adductors: 0.5, abs: 0.25 }, ['barbell', 'rack'], 4, 2, true, 5),
  X('hack_squat', 'Hack Squat', 'squat', { quads: 1, glutes: 0.5, adductors: 0.5 }, ['hack_squat'], 5, 4, true, 10),
  X('pendulum_squat', 'Pendulum Squat', 'squat', { quads: 1, glutes: 0.5, adductors: 0.5 }, ['pendulum'], 5, 5, true, 10),
  X('smith_squat', 'Smith Machine Squat', 'squat', { quads: 1, glutes: 0.5, adductors: 0.5 }, ['smith'], 4, 4, true, 10),
  X('goblet_squat', 'Heel-Elevated Goblet Squat', 'squat', { quads: 1, glutes: 0.5, adductors: 0.25 }, ['dumbbell'], 4, 3, true, 5),
  X('leg_press', 'Leg Press', 'leg_press', { quads: 1, glutes: 0.5, adductors: 0.5 }, ['leg_press'], 4, 4, true, 20),
  X('bulgarian', 'Bulgarian Split Squat', 'lunge', { quads: 1, glutes: 0.75, adductors: 0.5 }, ['dumbbell', 'bench'], 5, 3, true, 5),
  X('walking_lunge', 'Walking Lunge', 'lunge', { quads: 1, glutes: 0.75, adductors: 0.5 }, ['dumbbell'], 4, 2, true, 5),
  X('smith_split_squat', 'Smith Machine Split Squat', 'lunge', { quads: 1, glutes: 0.75, adductors: 0.5 }, ['smith'], 5, 4, true, 5),
  X('bw_split_squat', 'Bodyweight Split Squat', 'lunge', { quads: 1, glutes: 0.75 }, ['bodyweight'], 4, 3, true, 0),
  X('leg_ext', 'Leg Extension', 'leg_ext', { quads: 1 }, ['leg_ext'], 3, 5, false, 10),
  X('sissy_squat', 'Sissy Squat', 'leg_ext', { quads: 1 }, ['bodyweight'], 5, 3, false, 0),
  X('reverse_nordic', 'Reverse Nordic', 'leg_ext', { quads: 1 }, ['bodyweight'], 5, 3, false, 0),
  // ---- Hamstrings / glutes
  X('rdl', 'Romanian Deadlift', 'hinge', { hamstrings: 1, glutes: 0.75, lower_back: 0.5, adductors: 0.5 }, ['barbell'], 5, 3, true, 10),
  X('db_rdl', 'Dumbbell Romanian Deadlift', 'hinge', { hamstrings: 1, glutes: 0.75, lower_back: 0.5, adductors: 0.5 }, ['dumbbell'], 5, 3, true, 5),
  X('sldl', 'Stiff-Leg Deadlift', 'hinge', { hamstrings: 1, glutes: 0.75, lower_back: 0.5 }, ['barbell'], 5, 2, true, 10),
  X('deadlift', 'Conventional Deadlift', 'hinge', { glutes: 1, hamstrings: 0.75, lower_back: 0.75, quads: 0.5, traps: 0.5, upper_back: 0.25, forearms: 0.5 }, ['barbell'], 3, 1, true, 10),
  X('back_ext', '45° Back Extension', 'hinge', { glutes: 1, hamstrings: 0.75, lower_back: 0.5 }, ['back_extension'], 4, 4, false, 5),
  X('cable_pull_through', 'Cable Pull-Through', 'hinge', { glutes: 1, hamstrings: 0.75 }, ['cable'], 4, 4, false, 5),
  X('seated_curl', 'Seated Leg Curl', 'leg_curl', { hamstrings: 1 }, ['seated_leg_curl'], 5, 5, false, 5),
  X('lying_curl', 'Lying Leg Curl', 'leg_curl', { hamstrings: 1, calves: 0.25 }, ['lying_leg_curl'], 3, 5, false, 5),
  X('nordic', 'Nordic Ham Curl', 'leg_curl', { hamstrings: 1 }, ['bodyweight'], 4, 2, false, 0),
  X('db_leg_curl', 'Dumbbell Leg Curl', 'leg_curl', { hamstrings: 1 }, ['dumbbell', 'bench'], 3, 3, false, 5),
  X('hip_thrust', 'Barbell Hip Thrust', 'hip_thrust', { glutes: 1, hamstrings: 0.25, quads: 0.25 }, ['barbell', 'bench'], 2, 4, true, 10),
  X('smith_hip_thrust', 'Smith Machine Hip Thrust', 'hip_thrust', { glutes: 1, hamstrings: 0.25, quads: 0.25 }, ['smith', 'bench'], 2, 5, true, 10),
  X('glute_bridge', 'Single-Leg Glute Bridge', 'hip_thrust', { glutes: 1, hamstrings: 0.5 }, ['bodyweight'], 2, 3, false, 0),
  X('adductor_machine', 'Hip Adduction Machine', 'adduction', { adductors: 1 }, ['hip_adductor'], 4, 5, false, 10),
  X('copenhagen', 'Copenhagen Plank', 'adduction', { adductors: 1, abs: 0.25 }, ['bench'], 3, 3, false, 0),
  X('abductor_machine', 'Hip Abduction Machine', 'abduction', { glutes: 1 }, ['hip_abductor'], 3, 5, false, 10),
  // ---- Calves
  X('standing_calf', 'Standing Calf Raise', 'calf', { calves: 1 }, ['calf_machine'], 5, 5, false, 10),
  X('leg_press_calf', 'Leg Press Calf Raise', 'calf', { calves: 1 }, ['leg_press'], 5, 5, false, 20),
  X('smith_calf', 'Smith Machine Calf Raise', 'calf', { calves: 1 }, ['smith'], 5, 4, false, 10),
  X('db_calf', 'Single-Leg Dumbbell Calf Raise', 'calf', { calves: 1 }, ['dumbbell'], 5, 4, false, 5),
  X('bw_calf', 'Single-Leg Calf Raise (Step)', 'calf', { calves: 1 }, ['bodyweight'], 5, 3, false, 0),
  // ---- Abs
  X('cable_crunch', 'Cable Crunch', 'abs_flexion', { abs: 1 }, ['cable'], 4, 5, false, 5),
  X('hanging_leg_raise', 'Hanging Leg Raise', 'abs_flexion', { abs: 1 }, ['pullup_bar'], 4, 4, false, 0),
  X('decline_crunch', 'Weighted Decline Crunch', 'abs_flexion', { abs: 1 }, ['incline_bench', 'dumbbell'], 4, 4, false, 5),
  X('ab_crunch', 'Crunch', 'abs_flexion', { abs: 1 }, ['bodyweight'], 2, 3, false, 0),
  X('ab_wheel', 'Ab Wheel Rollout', 'abs_anti', { abs: 1, lats: 0.25 }, ['bodyweight'], 5, 4, false, 0),
];

export const BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));

export const ALL_EQUIPMENT = Object.keys(EQUIPMENT);
