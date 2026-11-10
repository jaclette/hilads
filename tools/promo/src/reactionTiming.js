// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): the ranking revealed in sequence and
// held to endSeconds (to read or pause), then the closing slide (the question, the invitation), 3 s. Classic: the
// headline hook, the ranking until 8 s (11 s in all); quiz: the quiz question alone 1 s and a 3, 2, 1 countdown (1 s each)
// until 4 s, everything 2.4 s later, the ranking until 10.5 s (13.5 s in all). Pure.

export const CLOSING_SECONDS = 3;
export const endSeconds = (mode) => (mode === 'quiz' ? 10.5 : 8);
export const reactionSeconds = (mode) => endSeconds(mode) + CLOSING_SECONDS;
