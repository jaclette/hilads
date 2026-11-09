// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): the ranking revealed in sequence and
// held to endSeconds (to read or pause), then the closing slide (the question, the invitation), 3 s. Classic: the
// headline hook, the ranking until 8 s (11 s in all); quiz: the quiz question and a countdown until 2.6 s, everything
// 1 s later, the ranking until 9 s (12 s in all). Pure.

export const CLOSING_SECONDS = 3;
export const endSeconds = (mode) => (mode === 'quiz' ? 9 : 8);
export const reactionSeconds = (mode) => endSeconds(mode) + CLOSING_SECONDS;
