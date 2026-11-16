# Lift — Workout App

A workout app for iPhone that you add to your Home Screen. It runs entirely in the browser, is hosted on GitHub Pages, and syncs to a private GitHub Gist.

## Features
- **Today:** pulls the next day in your program rotation, adjusts it to your equipment profile, and rates it.
- **Ratings:** each workout gets a 0–100 score and a letter grade built from three parts: muscle coverage (effective sets per target muscle), lengthened-position bias, and stimulus-to-fatigue ratio. Each exercise also gets its own grade. The Program tab rates your weekly sets per muscle against a target range.
- **Substitution:** exercises that need equipment you don't have are swapped automatically for the closest match by muscle and movement pattern. Tap **Taken** when a machine is busy to swap it on the spot.
- **Build:** pick a focus or specific muscles plus a time cap, and the app generates a workout from your equipment.
- **Logging:** log weight and reps for each set. The app suggests your next load with double progression, calculates warm-up sets, and runs a rest timer. The screen stays awake during a workout.
- **Training blocks:** 5 weeks: RIR 3 → 2 → 1 → 0–1, then a deload.
- **Progress:** estimated 1RM trend for each lift, workout history, and PR detection.

## Setup
1. GitHub repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save.
2. On your iPhone, open `https://kemoczulski-max.github.io/workout-app/` in Safari → Share → **Add to Home Screen**.
3. (Optional) To sync, go to github.com → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → generate a token with only the `gist` scope. Paste it in the app under **Setup → Sync**.

## Importing a program (e.g. from a PDF)
Upload the PDF to Claude and ask: *"Convert this into a Lift app program import."* Paste the result into **Program → Import**.

Format:
```json
{
  "type": "program",
  "name": "Program name",
  "days": [
    {
      "name": "Push A",
      "focus": "push",
      "slots": [
        { "ex": "db_incline", "sets": 3, "reps": [6, 10], "rest": 150 },
        { "name": "Some Exercise Not In The Library", "ex": "custom_zercher_squat", "sets": 3, "reps": [8, 12], "rest": 120 }
      ]
    }
  ],
  "customExercises": {
    "custom_zercher_squat": {
      "name": "Zercher Squat", "pattern": "squat",
      "muscles": { "quads": 1, "glutes": 0.75, "upper_back": 0.5 },
      "equip": ["barbell", "rack"], "len": 4, "sfr": 2, "compound": true, "inc": 5
    }
  }
}
```
- `focus`: `push`, `pull`, `legs`, `upper`, `lower` or `full`.
- `ex` must be an id from `js/exercises.js` or a key in `customExercises`. If the id is missing, the app tries to match on `name`.
- Muscle weights: `1` = prime mover, `0.5` = synergist, `0.25` = minor. `len` and `sfr` are scored 1–5.

### Optional program features
| Field | Where | What it does |
|---|---|---|
| `{"name": "Rest", "rest": true}` | `days[]` | A rest day inside the rotation. The weekday rest-day setting is ignored for programs that have these. |
| `tech` | slot | Intensity technique shown in gold (e.g. "Myo-Reps (final set)"). |
| `note` | slot | Coaching cues, shown under a "Cues" toggle. |
| `group` | slot | Superset / giant-set label (e.g. "A1"). Use `"rest": 0` to go straight to the next exercise with no timer. |
| `unit` | custom exercise | What the reps column counts: `"sec"`, `"passes"`, `"strides"`, `"reps/side"`, etc. Progress charts the best count instead of an estimated 1RM. |
| `cycles` | program | `[{ "label", "effort", "deload" }]`. Replaces the built-in 5-week block. `effort` is the target shown on each exercise (e.g. "RPE 8 → 9"). |
| `byCycle` | slot | One entry per cycle overriding `sets`, `reps`, `rest`, `ex`, `tech` or `note` for that cycle. Deload volume comes from here, not from automatic halving. |
| `startDate` | program | `"YYYY-MM-DD"` for Day 1 of Cycle 1. Used once at import: if the date has passed, the program starts where that schedule puts today. After that, the next workout only moves forward when you finish one; rest days pass on their own after a day without training. |
| `startCycle`, `startDay` | program | 1-based starting point when there is no past `startDate`. |

Example slot using several of these:
```json
{ "ex": "pec_deck_fly", "sets": 3, "reps": [12, 15], "rest": 0, "group": "A1",
  "note": "Take it to RPE 9, then go straight to A2.",
  "byCycle": [{ "sets": 3, "tech": "" }, { "sets": 3, "tech": "Superset with A2" }] }
```

## Files
- `js/exercises.js`: exercise library (muscles, equipment, stretch and SFR scores)
- `js/programs.js`: default 6-day PPL program
- `js/engine.js`: ratings, substitution, generator, progression
- `js/store.js`: local storage and Gist sync
- `js/app.js`: UI
