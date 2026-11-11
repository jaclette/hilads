// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): the ranking revealed in sequence and
// held to endSeconds (to read or pause), then the closing slide (the question, the invitation), 3 s. Classic: the
// headline hook, the ranking until 8 s (11 s in all); quiz: the quiz question alone 1 s and a 3, 2, 1 countdown (1 s each)
// until 4 s, everything 2.4 s later, the ranking until 10.5 s (13.5 s in all). Pure.

export const CLOSING_SECONDS = 3;
export const endSeconds = (mode) => (mode === 'quiz' ? 10.5 : 8);
export const reactionSeconds = (mode) => endSeconds(mode) + CLOSING_SECONDS;

// The race format (src/Reaction.jsx RaceVideo): no hook, the headline in its header from the first frame, settled from
// the first frame; every step of the data: the ranking held completely still (HOLD 0.8 s; a race of FEW steps or less:
// HOLD_FEW 2 s), then a quick, smooth move to the next step (MOVE 0.3 s); a 2.5 s freeze on the last step (the crown on
// #1), then the closing slide (3 s). The race itself lasts MAX 25 s at most: when every step at the normal pace would be
// longer, the last 12 to 15 steps keep it (the recent story) and the early ones go fast without holds (FAST 0.3 s a step,
// less if it must); the banner year, when it falls in the fast part, holds KEY 1 s. Same rule in backend/api/src/DwRace.php.
// A package can still set its own pace (step_seconds, hold: the share of a step held still; hold_first false; year_step;
// slow_from / slow_step).
export const RACE = { START: 0.6, HOLD: 0.8, HOLD_FEW: 2, MOVE: 0.3, FEW: 5, FREEZE: 2.5, MAX: 25, FAST: 0.3, MIN_FAST: 0.1, KEY: 1,
                      NORMAL_MAX: 15, NORMAL_MIN: 12 };
export const raceOpts = (o = {}) => {
  const holdFirst = o.holdFirst ?? true;
  const step = o.stepSeconds ?? o.step;
  const hold = o.hold != null ? Number(o.hold) : null;
  return { start: Number(o.startSeconds ?? o.start ?? RACE.START), step: step != null ? Number(step) : null, hold, holdFirst,
           freeze: Number(o.freezeSeconds ?? o.freeze ?? RACE.FREEZE),
           slowFrom: o.slowFrom != null ? Number(o.slowFrom) : null, slowStep: o.slowStep != null ? Number(o.slowStep) : null,
           bannerYear: o.bannerYear != null ? Number(o.bannerYear) : null };
};
/**
 * The race's schedule: one {len, hold} a step (seconds; step i goes from years[i] to years[i + 1]; hold: how long the
 * ranking stays still at years[i] before the move, or after it when holdFirst is false). Pure.
 */
export const raceSchedule = (years, o = {}) => {
  const r = raceOpts(o);
  const ys = years.map(Number);
  const m = Math.max(0, ys.length - 1);
  if (r.step != null || r.slowFrom != null || r.hold != null || !r.holdFirst) {
    // A package's own pace: `step` (slowStep from slowFrom), `hold` the share held still.
    const base = r.step ?? RACE.HOLD + RACE.MOVE;
    return ys.slice(1).map((y) => {
      const len = r.slowFrom != null && y >= r.slowFrom ? (r.slowStep ?? base) : base;
      const share = r.hold != null ? r.hold : r.holdFirst ? Math.max(0, (len - RACE.MOVE) / len) : 0;
      return { len, hold: Math.max(0, Math.min(0.95, share)) * len };
    });
  }
  const normal = { len: RACE.HOLD + RACE.MOVE, hold: RACE.HOLD };
  if (m <= RACE.FEW) return ys.slice(1).map(() => ({ len: RACE.HOLD_FEW + RACE.MOVE, hold: RACE.HOLD_FEW }));
  const budget = RACE.MAX - r.start - r.freeze;
  if (m * normal.len <= budget) return ys.slice(1).map(() => normal);
  const keyStep = r.bannerYear != null ? ys.indexOf(r.bannerYear) : -1;   // the step leaving the banner year
  let plan = null;
  for (let k = RACE.NORMAL_MAX; k >= RACE.NORMAL_MIN && !plan; k--) {
    const f = m - k;
    const extra = keyStep >= 0 && keyStep < f ? RACE.KEY : 0;
    if (f * RACE.FAST + extra + k * normal.len <= budget) plan = { k, fast: RACE.FAST, extra };
  }
  if (!plan) {
    const k = RACE.NORMAL_MIN, f = m - k;
    const extra = keyStep >= 0 && keyStep < f ? RACE.KEY : 0;
    plan = { k, fast: Math.max(RACE.MIN_FAST, (budget - extra - k * normal.len) / f), extra };
  }
  const f = m - plan.k;
  return ys.slice(1).map((_, i) => (i >= f ? normal : i === keyStep ? { len: plan.fast + RACE.KEY, hold: RACE.KEY } : { len: plan.fast, hold: 0 }));
};
/** Each step's length (seconds). */
export const raceSteps = (years, o = {}) => raceSchedule(years, o).map((x) => x.len);
export const raceEndSeconds = (years, o = {}) => raceOpts(o).start + raceSteps(years, o).reduce((a, b) => a + b, 0) + raceOpts(o).freeze;
export const raceSeconds = (years, o = {}) => raceEndSeconds(years, o) + CLOSING_SECONDS;
