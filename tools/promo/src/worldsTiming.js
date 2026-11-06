// "Different Worlds" video timings (src/Worlds.jsx), and how a clip fills a slide (pure).

export const FPS = 30;
export const FADE = 8;                                    // frames of crossfade into a slide
export const MIN_RATE = 0.65;                             // a short clip is slowed down, never more
export const DETAIL_DELAY = 18;                           // frames between the headline and its detail (0.6 s)

// A slide stays long enough to read all its text: base + per word, between min and max (seconds).
const READ = {
  hook:    { base: 2.0, perWord: 0.25, min: 3.5, max: 6 },
  country: { base: 2.2, perWord: 0.32, min: 4.5, max: 7.5 },
  outro:   { base: 3.2, perWord: 0.3,  min: 5.5, max: 8 },
};

const words = (s) => (s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
  .trim().split(/\s+/).filter(Boolean).length;

/** How long a slide shows, in seconds, from its text (headline + detail; the outro's question). */
export function slideSeconds(slide) {
  const r = READ[slide.kind] ?? READ.country;
  const n = words(slide.text) + words(slide.detail);
  return Math.round(Math.min(r.max, Math.max(r.min, r.base + n * r.perWord)) * 10) / 10;
}

/** How long a slide's clip plays: the slide plus its crossfade, in seconds. */
export const clipNeed = (seconds) => seconds + FADE / FPS;

/** The playback speed that makes $available seconds of clip fill a slide of $seconds (1 when long enough), or null: too short. */
export function clipRate(available, seconds) {
  const need = clipNeed(seconds);
  if (available >= need) return 1;
  const rate = available / need;
  return rate >= MIN_RATE ? Math.round(rate * 1000) / 1000 : null;
}
