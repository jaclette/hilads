// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): the ranking revealed in sequence and
// held to endSeconds (to read or pause), then the closing slide (the question, the invitation), 3 s. Classic: the
// headline hook, the ranking until 8 s (11 s in all); quiz: the quiz question alone 1 s and a 3, 2, 1 countdown (1 s each)
// until 4 s, everything 2.4 s later, the ranking until 10.5 s (13.5 s in all). Pure.

export const CLOSING_SECONDS = 3;
export const endSeconds = (mode) => (mode === 'quiz' ? 10.5 : 8);
export const reactionSeconds = (mode) => endSeconds(mode) + CLOSING_SECONDS;

// The race format (src/Reaction.jsx RaceVideo): no hook, the headline in its header from the first frame; the first
// year's bars grow in until 0.45 s, the race from 0.6 s (0.7 s a year), a 2 s freeze on the last year (the crown on
// #1), then the closing slide (3 s).
export const RACE = { START: 0.6, PER_YEAR: 0.7, FREEZE: 2 };
export const raceEndSeconds = (years) => RACE.START + Math.max(0, years - 1) * RACE.PER_YEAR + RACE.FREEZE;
export const raceSeconds = (years) => raceEndSeconds(years) + CLOSING_SECONDS;
