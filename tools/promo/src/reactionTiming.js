// "Different Worlds" reaction format timings (src/Reaction.jsx, worlds.mjs): with a question, the table
// screen 0 to 7 s, then the closing slide to 10 s; without one, the table screen alone, 8 s. Pure.

export const TABLE_SECONDS = 7;
export const REACTION_SECONDS = 10;
export const TABLE_ONLY_SECONDS = 8;
export const reactionSeconds = (question) => ((question ?? '').trim() ? REACTION_SECONDS : TABLE_ONLY_SECONDS);
