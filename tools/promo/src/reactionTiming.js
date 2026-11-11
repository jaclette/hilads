// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): the ranking revealed in sequence and
// held to endSeconds (to read or pause), then the closing slide (the question, the invitation), 3 s. Classic: the
// headline hook, the ranking until 8 s (11 s in all); quiz: the quiz question alone 1 s and a 3, 2, 1 countdown (1 s each)
// until 4 s, everything 2.4 s later, the ranking until 10.5 s (13.5 s in all). Pure.

export const CLOSING_SECONDS = 3;
export const endSeconds = (mode) => (mode === 'quiz' ? 10.5 : 8);
export const reactionSeconds = (mode) => endSeconds(mode) + CLOSING_SECONDS;

// The race format (src/Reaction.jsx RaceVideo): no hook, the headline in its header from the first frame; the first
// year's bars grow in until 0.45 s, the race from `start` (0.6 s), `step` seconds a year (0.7), each step moving during
// its first (1 − hold) and holding the rest (hold 0: always moving; few editions: 2.5 s, hold 0.55), a 2 s freeze on
// the last year (the crown on #1), then the closing slide (3 s).
export const RACE = { START: 0.6, PER_YEAR: 0.7, FREEZE: 2 };
export const raceOpts = (o = {}) => ({ start: Number(o.startSeconds ?? o.start ?? RACE.START), step: Number(o.stepSeconds ?? o.step ?? RACE.PER_YEAR),
                                       hold: Math.max(0, Math.min(0.8, Number(o.hold ?? 0))),
                                       // holdFirst: each step holds still first (to read the ranking), then moves (default: moves, then holds).
                                       holdFirst: o.holdFirst === true,
                                       freeze: Number(o.freezeSeconds ?? o.freeze ?? RACE.FREEZE),
                                       slowFrom: o.slowFrom != null ? Number(o.slowFrom) : null, slowStep: Number(o.slowStep ?? o.stepSeconds ?? RACE.PER_YEAR) });
/** Each step's length (seconds, step i goes from years[i] to years[i + 1]): `step`, or `slowStep` from the year `slowFrom`. */
export const raceSteps = (years, o = {}) => {
  const r = raceOpts(o);
  const ys = Array.isArray(years) ? years.map(Number) : Array.from({ length: years }, (_, i) => i);
  return ys.slice(1).map((y) => (r.slowFrom != null && Array.isArray(years) && y >= r.slowFrom ? r.slowStep : r.step));
};
export const raceEndSeconds = (years, o = {}) => raceOpts(o).start + raceSteps(years, o).reduce((a, b) => a + b, 0) + raceOpts(o).freeze;
export const raceSeconds = (years, o = {}) => raceEndSeconds(years, o) + CLOSING_SECONDS;
